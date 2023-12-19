// For more information, see https://crawlee.dev/
import { Dataset, EnqueueStrategy, Log, PlaywrightCrawler, RequestQueue, RequestQueueV2, RequestState } from 'crawlee';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { Page } from 'playwright';
import Services from '../services.json';
import _ from 'lodash';
import { NodeHtmlMarkdown, NodeHtmlMarkdownOptions } from 'node-html-markdown'

// PlaywrightCrawler crawls the web using a headless
// browser controlled by the Playwright library.
interface Endpoint {
    name: string;
    rawHtml: string;
    markdown: string;
    parsedHtml: ReturnType<typeof Readability.prototype.parse>;
}

interface EndpointSelectors {
    name?: string;
    delimiter?: string;
    click?: string;
    link?: string;
}

interface SinglePageFlatSectionParserArgs {
    page: Page;
    selectors: EndpointSelectors;
    log: Log;
}

interface ScraperConfig {
    url: string;
    type: 'singlePage' | 'individualPages' | 'singlePageSections';
    selectors?: EndpointSelectors;
    globs?: string[];
    dataset: Dataset;
}

function getReadableHtml(html: string) {
    const doc = new JSDOM(html);
    let reader = new Readability(doc.window.document);
    
    return reader.parse();
}

async function parserSinglePageSections({ page, selectors }: SinglePageFlatSectionParserArgs) {
    if (!selectors.delimiter || !selectors.name) {
        throw new Error('Delimiter and name is required for singlePageSections');
    } 
    let endpoints: Endpoint[] = [];
    const htmlSections = await page.locator(selectors.delimiter).all();
    for (const delimiterElement of htmlSections) {
        await delimiterElement.scrollIntoViewIfNeeded();
        await delimiterElement.evaluate((element) => element.scrollIntoView());
        const rawHtml = await delimiterElement.evaluate((element) => element.outerHTML);
        const parsedHtml = await getReadableHtml(rawHtml);
        const markdown = NodeHtmlMarkdown.translate(rawHtml);
        const name = await delimiterElement.evaluate((element, selectors) => element.querySelector(selectors?.name ?? '')?.textContent ?? '', selectors);

        console.log('After name text', name)
        
        endpoints.push({
            name,
            parsedHtml,
            rawHtml,
            markdown,
        })
    }

    // const htmlSections = await page.$$eval(selectors.delimiter, async (delimiterElements) => {
    //     let sectionsHtml: string[] = [];
    //     for (const delimiterElement of delimiterElements) {
    //         delimiterElement.scrollIntoView();
    //         await new Promise((resolve) => setTimeout(resolve, 200));
    //         sectionsHtml.push(delimiterElement.outerHTML)
    //     }

    //     return sectionsHtml;
    // });

    // const endpoints = await Promise.all(htmlSections.map(async (rawHtml) => {
    //     const doc = new JSDOM(rawHtml);
    
    //     const name = doc.window.document.querySelector(selectors?.name ?? '')?.textContent ?? '';
    //     const parsedHtml = await getReadableHtml(rawHtml);
    //     const markdown = NodeHtmlMarkdown.translate(rawHtml);
    //     return {
    //         name,
    //         parsedHtml,
    //         rawHtml,
    //         markdown,
    //     }
    // }));
    return endpoints;
}

// async function parserOpenApi({ page }: SinglePageFlatSectionParserArgs) {
//     const operations = await page.locator('[aria-expanded="false"]').all();
//     for (const operation of operations) {
//         await operation.click();
//     }

//     const sections = await page.locator('.opblock.is-open').all();
//     for (const endpoint of sections) {
//         await endpoint.scrollIntoViewIfNeeded();
//         const name = await endpoint.locator('.opblock-summary-description').textContent();
//         const rawHtml = await endpoint.innerHTML();
//         const markdown = NodeHtmlMarkdown.translate(rawHtml);

//     }


//     const htmlSections = await page.$$eval(selectors.delimiter, async (delimiterElements) => {
//         let sectionsHtml: string[] = [];
//         for (const delimiterElement of delimiterElements) {
//             delimiterElement.scrollIntoView();
//             await new Promise((resolve) => setTimeout(resolve, 200));
//             sectionsHtml.push(delimiterElement.outerHTML)
//         }

//         return sectionsHtml;
//     });

//     const endpoints = await Promise.all(htmlSections.map(async (rawHtml) => {
//         const doc = new JSDOM(rawHtml);
    
//         let reader = new Readability(doc.window.document);
//         const name = doc.window.document.querySelector(selectors?.name ?? '')?.textContent ?? '';
//         const parsedHtml = await reader.parse();
//         const markdown = NodeHtmlMarkdown.translate(rawHtml);
//         return {
//             name,
//             parsedHtml,
//             rawHtml,
//             markdown,
//         }
//     }));
//     return endpoints;
// }

async function parserSinglePageFlatSection({ page, selectors }: SinglePageFlatSectionParserArgs) {
    if (!selectors.delimiter || !selectors.name) {
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

            // Add the html content to the sections array
            return htmlContent;
        });

        return endpointPromises;
    });

    const completeEndpoints = await Promise.all(htmlSections.map(async (rawHtml: string) => {
        const doc = new JSDOM(rawHtml);
        
        let reader = new Readability(doc.window.document);
        const name = doc.window.document.querySelector(selectors?.name ?? 'h1')?.textContent ?? '';
        const parsedHtml = await reader.parse();
        const markdown = NodeHtmlMarkdown.translate(rawHtml);

        return {
            name,
            parsedHtml,
            rawHtml,
            markdown,
        }
    }));

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
        rawHtml,
        markdown
    }];
}

async function scrape({ type, url, globs, selectors, dataset }: ScraperConfig) {
    const crawler = new PlaywrightCrawler({
        // Use the requestHandler to process each of the crawled pages.
        async requestHandler({ request, page, enqueueLinks, log, closeCookieModals, enqueueLinksByClickingElements }) {
            closeCookieModals();
            let h1: string | undefined;
            try {
                h1 = await page.$eval('h1', (h1) => h1.textContent?.trim());
            } catch {}

            const title = h1 || await page.title();

            log.info(`Title of ${request.loadedUrl} is '${title}'`);
            await page.waitForLoadState('networkidle')
            let endpoints: Endpoint[] = [];
            if (type === 'singlePage' && selectors) {
                endpoints = await parserSinglePageFlatSection({ page, selectors, log });
            } else if (type === 'singlePageSections' && selectors) {
                endpoints = await parserSinglePageSections({ page, selectors, log });
            } else if (type === 'individualPages') {
                endpoints = await parserIndividualPage({ page, log });
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
                console.log("🚀 ~ file: main.ts:177 ~ requestHandler ~ globs:", globs)
                await enqueueLinks({
                    globs: globs ?? undefined
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
        headless: false,
        
    });
    // Define the starting URL
    await crawler.addRequests([url]);
    await crawler.run();
}

async function crawlServices() {
    for (const service of Services) {
        if (service.service_id !== 92 || !service.type) continue;
        const dataset = await Dataset.open(`${service.service_id}__${_.snakeCase(service.name)}__${service.type}`);
        const type = service.type as ScraperConfig['type'];

        await scrape({ 
            type, 
            dataset, 
            url: service.reference_url, 
            globs: service.globs, 
            selectors: service.selectors
        });
    }
}

crawlServices();

// const singlePageFlat = [
//     'https://developers.clicksend.com/docs/rest/v3',

// ]
// Add first URL to the queue and start the crawl.
