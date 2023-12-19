// For more information, see https://crawlee.dev/
import { Dataset, EnqueueStrategy, InfiniteScrollOptions, Log, PlaywrightCrawler, RequestQueue, RequestQueueV2, RequestState } from 'crawlee';
import { Actor } from 'apify';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { ElementHandle, Page } from 'playwright';
import Services from '../services.json';
import _ from 'lodash';
import { NodeHtmlMarkdown, NodeHtmlMarkdownOptions } from 'node-html-markdown'

// PlaywrightCrawler crawls the web using a headless
// browser controlled by the Playwright library.
interface Endpoint {
    name: string;
    markdown: string;
    parsedHtml: ReturnType<typeof Readability.prototype.parse>;
    rawHtml?: string;
}

interface EndpointSelectors {
    name?: string;
    delimiter?: string;
    click?: string;
    link?: string;
}

interface SinglePageFlatSectionParserArgs {
    page: Page;
    selectors?: EndpointSelectors;
    log?: Log;
}

interface ScraperConfig {
    url: string;
    type: 'singlePage' | 'individualPages' | 'singlePageSections' | 'swagger';
    selectors?: EndpointSelectors;
    globs?: string[];
    globs_exclude?: string[];
    dataset: Dataset;
    timeout?: number;
}

function getReadableHtml(html: string) {
    const doc = new JSDOM(html);
    let reader = new Readability(doc.window.document);
    
    return reader.parse();
}

async function parserSinglePageSections({ page, selectors }: SinglePageFlatSectionParserArgs) {
    if (!selectors?.delimiter || !selectors?.name) {
        throw new Error('Delimiter and name is required for singlePageSections');
    } 
    let endpoints: Endpoint[] = [];
    const htmlSections = await page.locator(selectors?.delimiter).all();
    for (const delimiterElement of htmlSections) {
        await delimiterElement.evaluate((element) => element.scrollIntoView());
        const rawHtml = await delimiterElement.evaluate((element) => element.outerHTML);
        const parsedHtml = getReadableHtml(rawHtml);
        const markdown = NodeHtmlMarkdown.translate(rawHtml);
        const name = await delimiterElement.evaluate((element, selectors) => element.querySelector(selectors?.name ?? '')?.textContent ?? '', selectors);

        console.log('After name text', name)
        
        endpoints.push({
            name,
            parsedHtml,
            // rawHtml,
            markdown,
        })
    }

    return endpoints;
}

async function parseSwagger({ page }: SinglePageFlatSectionParserArgs) {
    const operations = await page.locator('.opblock-summary .opblock-summary-control').all();
    try {
        await page.locator('.qc-cmp2-summary-buttons button[mode="primary"]').click();
    } catch {}
    for (const operation of operations) {
        await operation.scrollIntoViewIfNeeded();
        await operation.click();
    }

    const endpoints: Endpoint[] = [];
    const sections = await page.locator('.opblock.is-open').all();
    for (const endpoint of sections) {
        await endpoint.evaluate((element) => element.scrollIntoView());
        const name = await endpoint.locator('.opblock-summary-description').textContent() ?? '';
        const rawHtml = await endpoint.innerHTML();
        const markdown = NodeHtmlMarkdown.translate(rawHtml);
        const parsedHtml = getReadableHtml(rawHtml);

        endpoints.push({
            name: name.trim(),
            // rawHtml,
            markdown,
            parsedHtml
        });
    }

    return endpoints;
}
async function parserSinglePageFlatSection({ page, selectors }: SinglePageFlatSectionParserArgs) {
    if (!selectors?.delimiter || !selectors.name) {
        throw new Error('Delimiter and name is required for parserSinglePageFlatSection');
    }
    const htmlSections = await page.$$eval(selectors.delimiter, (delimiterElements) => {
        const endpointPromises = delimiterElements.map((delimiterElement, index) => {
            const nextDelimiter = delimiterElements?.[index + 1] || null;;
            let htmlContent = delimiterElement.outerHTML;
            let nextElement = delimiterElement.nextElementSibling;

            // While there is a next element and it's not the next h2
            while (nextElement && nextElement !== nextDelimiter) {
                htmlContent += nextElement.outerHTML;
                nextElement = nextElement.nextElementSibling;
            }
            // nextElement?.scrollIntoView();
            // Add the html content to the sections array
            return htmlContent;
        });

        return endpointPromises;
    });

    const completeEndpoints = await Promise.all(htmlSections.map(async (rawHtml: string) => {
        const doc = new JSDOM(rawHtml);
        
        // const markdown = NodeHtmlMarkdown.translate(rawHtml);
        // const parsedHtml = getReadableHtml(rawHtml);
        const name = doc.window.document.querySelector(selectors?.name ?? '')?.textContent ?? '';
        // console.log("🚀 ~ file: main.ts:133 ~ completeEndpoints ~ name:", name)

        return {
            name,
            // parsedHtml,
            rawHtml,
            // markdown,
        }
    }));

    return completeEndpoints;
}

// async function parserSinglePageFlatSection({ page, selectors }: SinglePageFlatSectionParserArgs): Promise<Endpoint[]> {
//     if (!selectors?.delimiter || !selectors?.name) {
//         throw new Error('Delimiter and name are required for parserSinglePageFlatSection');
//     }

//     const endpoints: Endpoint[] = [];
//     const delimiterLocator = page.locator(selectors?.delimiter);
//     const sectionCount = await delimiterLocator.count();

//     for (let i = 0; i < sectionCount; i++) {
//         // Define the range for this section
//         const startDelimiter = delimiterLocator.nth(i);
//         const endDelimiter = i + 1 < sectionCount ? delimiterLocator.nth(i + 1) : null;
//         // console.log('Processing before scroll')
//         // Scroll the start delimiter into view
//         await startDelimiter.evaluate((element) => element.scrollIntoView());
//         // console.log('Processing after scroll')
//         // await startDelimiter.scrollIntoViewIfNeeded();

//         // Extract the HTML content for this section
//         const htmlContent = await page.evaluate(({ start, end }) => {
//             let content = start?.outerHTML;
//             let element = start?.nextElementSibling;
//             while (element && (!end || element !== end)) {
//                 content += element.outerHTML;
//                 element = element.nextElementSibling;
//             }
//             return content ?? '';
//         }, {
//             start: await startDelimiter.elementHandle(),
//             end: endDelimiter ? await endDelimiter.elementHandle() : null
//         });


//         const doc = new JSDOM(htmlContent);
//         const markdown = NodeHtmlMarkdown.translate(htmlContent);
//         const parsedHtml = getReadableHtml(htmlContent);
//         const name = doc.window.document.querySelector(selectors?.name ?? '')?.textContent ?? '';
//         console.log("🚀 ~ file: main.ts:142 ~ parserSinglePageFlatSection ~ name:", name)


//         // Push the endpoint data to the array
//         endpoints.push({
//             name: name.trim(),
//             rawHtml: htmlContent,
//             markdown,
//             parsedHtml,
//         });
//     }

//     return endpoints
// }


async function parserIndividualPage({ page }: { page: Page, log: Log; }) {
    const rawHtml = await page.$eval('body', (body) => body.innerHTML)
    let h1: string | undefined;
    try {
        h1 = await page.$eval('h1', (h1) => h1.textContent?.trim());
    } catch {}

    const title = h1 || await page.title();

    const doc = new JSDOM(rawHtml);
   
    const tagsToRemove = ['script', 'style', 'link', 'i', 'meta', 'svg', 'img'];
    tagsToRemove.forEach(tag => doc.window.document.querySelectorAll(tag).forEach(element => element.remove()));

    let reader = new Readability(doc.window.document);
    const parsedHtml = await reader.parse();
    const markdown = NodeHtmlMarkdown.translate(rawHtml);
    
    return [{
        name: h1 ?? title,
        parsedHtml,
        // rawHtml,
        markdown
    }];
}

function parseRawHtml(rawHtml: string) {
    const markdown = NodeHtmlMarkdown.translate(rawHtml);
    const parsedHtml = getReadableHtml(rawHtml);

    return {
        parsedHtml,
        markdown,
    }
}
async function scrape({ type, url, globs, selectors, dataset, globs_exclude, timeout }: ScraperConfig) {
    const crawler = new PlaywrightCrawler({
        requestHandlerTimeoutSecs: 360,
        // Use the requestHandler to process each of the crawled pages.
        async requestHandler({ request, page, enqueueLinks, log, closeCookieModals, enqueueLinksByClickingElements }) {
            await page.waitForLoadState('networkidle')
            
            log.info(`Processing ${request.loadedUrl}`);
            if(timeout) {
                console.log('Waiting for timeout', timeout)
                await page.waitForTimeout(timeout);
                console.log('Finished wait')
            }
            await closeCookieModals();
            let h1: string | undefined;
            try {
                h1 = await page.$eval('h1', (h1) => h1.textContent?.trim());
            } catch {}

            const title = h1 || await page.title();
            log.info(`Title of ${request.loadedUrl} is '${title}'`);

            let endpoints: Endpoint[] = [];
            if (type === 'singlePage' && selectors) {                
                const endpointsSet: Map<string, Partial<Endpoint>> = new Map();
                
                
                // Scroll in intervals of 1/4 of the window height
                const windowHeight = await page.evaluate(() => window.innerHeight);
                let offsetHeight = await page.evaluate(() => document.body.offsetHeight);
                let scrollAmount = windowHeight * 1;
                let scrollPosition = 0;
                const startTime = Date.now();
                while (scrollPosition < offsetHeight) {
                    await page.evaluate((scrollAmount) => window.scrollBy(0, scrollAmount), scrollAmount);
                    // await page.waitForTimeout(100);
                    const scrollEndpoints = await parserSinglePageFlatSection({ page, selectors, log });
                    scrollEndpoints.forEach(newEndpoint => endpointsSet.set(newEndpoint.name, newEndpoint));
                    
                    scrollPosition += scrollAmount;
                    offsetHeight = await page.evaluate(() => document.body.offsetHeight);
                    // scrollAmount = offsetHeight * 0.1;
                    // Log scroll position in %
                    log.info(`Scroll position: ${Math.round(scrollPosition / offsetHeight * 100)}%`);
                    log.info(`Items: ${endpointsSet.size}`);
                }
                const endScrollingTime = Date.now();
                log.info(`Scrolling took ${endScrollingTime - startTime}ms`);
                // await page.waitForTimeout(3000);
                // await page.keyboard.press('End');
                // await page.waitForTimeout(3000);
                // await page.keyboard.press('Home');
                // await infiniteScroll({ 
                //     scrollDownAndUp: true,
                //     timeoutSecs: 10,
                //     stopScrollCallback: async () => {
                //         log.info('Scrolling')
                //         const scrollEndpoints = await parserSinglePageFlatSection({ page, selectors, log });
                //         scrollEndpoints.forEach(newEndpoint => endpointsSet.set(newEndpoint.name, newEndpoint));
                //         log.info(`Items: ${endpointsSet.size}%`);
                //     }
                // })
                // await page.waitForTimeout(1000);
                // 344 endpoints
                // const scrollEndpoints = await parserSinglePageFlatSection({ page, selectors, log });
                //     scrollEndpoints.forEach(newEndpoint => endpointsSet.set(newEndpoint.name, newEndpoint));
                // scrollEndpoints.forEach(newEndpoint => endpointsSet.add(newEndpoint));
                console.log('Endpoints', endpointsSet.size)
                const partialEndpoints = [...endpointsSet.values()];
                const parsedEndpoints: Endpoint[] = partialEndpoints
                    .filter(e => e.rawHtml)
                    .map(e => ({ 
                        name: e.name ?? '',
                        ...parseRawHtml(e.rawHtml!) }
                    ));

                const endParsingTime = Date.now();
                log.info(`Parsing took ${endParsingTime - endScrollingTime}ms`);
                endpoints.push(...parsedEndpoints);
            } else if (type === 'singlePageSections' && selectors) {
                endpoints = await parserSinglePageSections({ page, selectors, log });
            } else if (type === 'individualPages') {
                endpoints = await parserIndividualPage({ page, log });
            } else if (type === 'swagger') {
                endpoints = await parseSwagger({ page });
            }

            
            if (selectors?.click) {
                const allSubmenus = await page.locator(selectors?.click);
                for (const submenu of await allSubmenus.all()) {
                    if(!submenu) continue;
                    await submenu.scrollIntoViewIfNeeded();
                    await submenu.click();
                }
            }

            await dataset.pushData({ title, url: request.loadedUrl, endpoints });
            if (type === 'individualPages') {
                await enqueueLinks({
                    globs: globs ?? undefined,
                    exclude: globs_exclude ?? undefined,
                });

                if (selectors?.click) {
                    await enqueueLinksByClickingElements({
                        selector: selectors?.click,
                        globs: globs ?? undefined
                    })
                }

                if (selectors?.link) {
                    const allLinks = await page.locator(selectors?.link).all();
                    for (const link of allLinks) {
                        const href = await link.getAttribute('href');
                        const absoluteUrl = new URL(href ?? '', request.loadedUrl).href;
    
                        if (absoluteUrl) {
                            await crawler.requestQueue?.addRequest({ url: absoluteUrl, uniqueKey: absoluteUrl })
                        }
                    }
                }

            }            
        },
        maxConcurrency: 3,
        // Comment this option to scrape the full website.
        // maxRequestsPerCrawl: 20,
        // Uncomment this option to see the browser window.
        // headless: false,
        
    });
    // Define the starting URL
    await crawler.addRequests([url]);
    await crawler.run();
}

async function crawlServices() {
    for (const service of Services) {
        if (service.service_id !== 152 || !service.type) continue;
        const dataset = await Dataset.open(`${service.service_id}__${_.snakeCase(service.name)}__${service.type}`);
        const type = service.type as ScraperConfig['type'];

        await scrape({ 
            type, 
            dataset, 
            url: service.reference_url, 
            globs: service.globs, 
            // timeout: service.timeout, 
            selectors: service.selectors,
            globs_exclude: service.globs_exclude
        });
    }
}
await Actor.init();
await crawlServices();
await Actor.exit();


// const singlePageFlat = [
//     'https://developers.clicksend.com/docs/rest/v3',

// ]
// Add first URL to the queue and start the crawl.
