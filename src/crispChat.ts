// // For more information, see https://crawlee.dev/
// import { PlaywrightCrawler } from 'crawlee';
// import { Readability } from '@mozilla/readability';
// import { JSDOM } from 'jsdom';
// // PlaywrightCrawler crawls the web using a headless
// // browser controlled by the Playwright library.
// interface Endpoint {
//     name: string;
//     id: string;
//     specs: string;
//     examples: string;
//     specsArticle: ReturnType<typeof Readability.prototype.parse>;
//     examplesArticle: ReturnType<typeof Readability.prototype.parse>;
// }

// const crawler = new PlaywrightCrawler({
//     // Use the requestHandler to process each of the crawled pages.
//     async requestHandler({ request, page, enqueueLinks, log,pushData, enqueueLinksByClickingElements, closeCookieModals,  }) {
//         closeCookieModals();
//         const title = await page.title();
//         log.info(`Title of ${request.loadedUrl} is '${title}'`);
//         const endpoints: Partial<Endpoint>[] = await page.$$eval('.parts .part', (parts) => {
//             const endpointPromises = parts.map((p) => {
//                 const name = p.querySelector('.request-title')?.textContent ?? '';
//                 const id = p.querySelector('.request-title a')?.getAttribute('href') ?? '';
//                 const specs = p.querySelector('.request-specification')?.innerHTML ?? '';
//                 const examples = p.querySelector('.examples')?.innerHTML ?? '';
//                 const method = p.querySelector('.request-target-method')?.textContent ?? '';
//                 const endpoint = p.querySelector('.request-target-path')?.textContent ?? '';

//                 return {
//                     name,
//                     id,
//                     specs,
//                     examples,
//                     method,
//                     endpoint,
//                 };
//             });

//             return endpointPromises;
//         });

//         const completeEndpoints = await Promise.all(endpoints.map(async (endpoint) => {
//             const docExamples = new JSDOM(endpoint.examples);
//             let readerExamples = new Readability(docExamples.window.document);
//             const examplesArticle = await readerExamples.parse();
//             const docSpecs = new JSDOM(endpoint.specs);
//             let readerSpecs = new Readability(docSpecs.window.document);
//             const specsArticle = await readerSpecs.parse();
//             return {
//                 ...endpoint,
//                 specsArticle,
//                 examplesArticle,
//             }
//         }));

        
//         // const endpoints = await page.$$eval('a.nest-navigate-link', (links) => links.map((link) => link.href));
//         // const doc = await page.evaluateHandle(() => document);
//         // const pageHtml = await page.content();
//         // let article = reader.parse();
//         // Save results as JSON to ./storage/datasets/default
//         await pushData({ title, url: request.loadedUrl, endpoints: completeEndpoints });
//         // Extract links from the current page
//         // and add them to the crawling queue.
//         // await enqueueLinks({
//         //     selector: 'a.nest-navigate-link'
//         // });
//     },
//     // Comment this option to scrape the full website.
//     maxRequestsPerCrawl: 10,
//     // Uncomment this option to see the browser window.
//     // headless: false,
// });

// // Add first URL to the queue and start the crawl.
// await crawler.run(['https://docs.crisp.chat/references/rest-api/v1/']);
