// For more information, see https://crawlee.dev/
import { Dataset, EnqueueStrategy, InfiniteScrollOptions, Log, PlaywrightCrawler, RequestQueue, RequestQueueV2, RequestState } from 'crawlee';
import { Actor } from 'apify';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { ElementHandle, Page } from 'playwright';
import Services from '../services.json' assert { type: "json" };
import _ from 'lodash';
import { NodeHtmlMarkdown, NodeHtmlMarkdownOptions } from 'node-html-markdown'
import { v4 as uuid } from 'uuid';

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
    timeout?: number;
}

interface ActorInputSchema  {
    startUrl: string;
    docsType: ScraperConfig['type'];
    name: string;
    globs: string[];
    globs_exclude: string[];
    clickSelector: string;
    sectionsDelimiterSelector: string;
    nameSelector: string;
    maxCrawlDepth: number;
    maxCrawlPages: number;
};
  

function getReadableHtml(html: string) {
    const doc = new JSDOM(html);
    let reader = new Readability(doc.window.document);
    
    return reader.parse();
}

async function parserSinglePageSections({ page, selectors }: SinglePageFlatSectionParserArgs) {
    if (!selectors?.delimiter || !selectors?.name) {
        throw new Error('Delimiter and name is required for singlePageSections');
    } 
    let endpoints: Partial<Endpoint>[] = [];
    const htmlSections = await page.locator(selectors?.delimiter).all();
    for (const delimiterElement of htmlSections) {
        const rawHtml = await delimiterElement.evaluate((element) => element.outerHTML);
        const name = await delimiterElement
            .evaluate(
                (element, selectors) => element.querySelector(selectors?.name ?? '')?.textContent ?? '', selectors
            ) ?? '';

        endpoints.push({
            name,
            rawHtml,
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

            // While there is a next element and it's not the next delimiter
            while (nextElement && nextElement !== nextDelimiter) {
                htmlContent += nextElement.outerHTML;
                nextElement = nextElement.nextElementSibling;
            }


            return htmlContent;
        });

        return endpointPromises;
    });

    const completeEndpoints = await Promise.all(
        htmlSections.map(async (rawHtml: string) => {
            const doc = new JSDOM(rawHtml);
            const name = doc.window.document.querySelector(selectors?.name ?? '')?.textContent ?? '';

            return {
                name,
                rawHtml,
            }
        })
    );

    return completeEndpoints;
}

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

function isStableForLastNScrolls(history: number[], n: number) {
    if (history.length < n) return false;
    const recentHistory = history.slice(-n);
    return new Set(recentHistory).size === 1;
}

async function scrape({ type, url, globs, selectors, globs_exclude, timeout }: ScraperConfig, dataset: Dataset) {
    const crawler = new PlaywrightCrawler({
        requestHandlerTimeoutSecs: 360,
        // Use the requestHandler to process each of the crawled pages.
        async requestHandler({ request, page, enqueueLinks, log, closeCookieModals, enqueueLinksByClickingElements }) {
            const start = Date.now();
            log.info(`Processing ${request.loadedUrl}`);
            await page.waitForLoadState('networkidle')
            const endNetworkIdle = Date.now();
            log.info(`Network idle after ${endNetworkIdle - start}ms`);
            
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
            if (['singlePage', 'singlePageSections'].includes(type) && selectors) {               
                const parsingFunction = type === 'singlePage' ? parserSinglePageFlatSection : parserSinglePageSections; 
                const endpointsSet: Map<string, Partial<Endpoint>> = new Map();
                
                // Scroll in intervals of 1/4 of the window height
                const windowHeight = await page.evaluate(() => window.innerHeight);
                let scrollHeight = await page.evaluate(() => document.body.scrollHeight);
                let scrollAmount = windowHeight * 1;
                let scrollPosition = 0;
                const scrollSizeHistory: number[] = [];
                const startTime = Date.now();
                while (scrollPosition < scrollHeight) {
                    await page.evaluate((scrollAmount) => window.scrollBy(0, scrollAmount), scrollAmount);
                    const scrollEndpoints = await parsingFunction({ page, selectors, log });

                    if (scrollEndpoints.filter(e => !e.name || e.name === '').length > 0) {
                        console.log('Missing endpoint name', scrollEndpoints.filter(e => !e.name || e.name === ''))
                    }
                    scrollEndpoints.forEach(newEndpoint => endpointsSet.set(newEndpoint.name ?? '', newEndpoint));
                    
                    const endpointsCount = endpointsSet.size;
                    scrollSizeHistory.push(endpointsCount);

                    const isStable = isStableForLastNScrolls(scrollSizeHistory, 2);
                    const isLastScroll = scrollHeight - scrollPosition < scrollAmount;

                    if(isStable && !isLastScroll) {
                        log.info(`Scrolling is stable, next scroll will be the last one`);
                    }

                    scrollPosition =  isStable && !isLastScroll
                        ? scrollHeight - 1
                        : scrollPosition + scrollAmount;
                    scrollHeight = await page.evaluate(() => document.body.scrollHeight);

                    log.info(`Scroll position: ${Math.round(scrollPosition / scrollHeight * 100)}%, ${endpointsCount} items parsed`);
                }
                const endScrollingTime = Date.now();
                log.info(`Scrolling took ${endScrollingTime - startTime}ms`);

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
            } 
            
            if (type === 'individualPages') {
                endpoints = await parserIndividualPage({ page, log });
            }
            if (type === 'swagger') {
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
        const serviceData = {
            id: service.service_id ?? uuid(),
            name: service.name,
            type: service.type as ScraperConfig['type'],
            url: service.reference_url,
            selectors: service.selectors,
            globs: service.globs,
            globs_exclude: service.globs_exclude,
            dataset: null as unknown as Dataset,
        }
        const dataset = await Dataset.open(`${serviceData.id}--${_.kebabCase(serviceData.name)}--${serviceData.type}`);

        await scrape({
            type: serviceData.type,
            url: serviceData.url,
            selectors: serviceData.selectors,
            globs: serviceData.globs,
            globs_exclude: serviceData.globs_exclude
        }, dataset);
    }
}
await Actor.init();
// const input = await Actor.getInput() as ActorInputSchema;
// if (input) {
//     console.log("🚀 ~ file: main.ts:419 ~ input:", input)
//     const payload: ScraperConfig = {
//         url: input?.startUrl,
//         type: input?.docsType,
//         globs: input?.globs,
//         globs_exclude: input?.globs_exclude,
//         selectors: {
//             click: input?.clickSelector,
//             delimiter: input?.sectionsDelimiterSelector,
//             name: input?.nameSelector
//         },
//         // maxCrawlDepth: input?.maxCrawlDepth,
//         // maxCrawlPages: input?.maxCrawlPages
//     }
//     const dataset = await Dataset.open(`${uuid()}--${_.kebabCase(input.name)}--${payload.type}`);
    
//     await scrape(payload, dataset);
// } else {
// }
await crawlServices();
await Actor.exit();


// const singlePageFlat = [
//     'https://developers.clicksend.com/docs/rest/v3',

// ]
// Add first URL to the queue and start the crawl.
