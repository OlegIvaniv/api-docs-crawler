# API Specs Docs Crawler

This project is an API specs documentation crawler that extracts endpoints and their descriptions using Crawlee & Playwright. It supports three common types of API specs documentation: individualPages, singlePage, and singlePageSections.

## Features

- Crawls API documentation to extract endpoints and their descriptions
- Supports three types of API specs documentation: individualPages, singlePage, and singlePageSections
- Utilizes Crawlee & Playwright for efficient and robust crawling
- Configurable via parameters to customize the crawling behavior

## Supported API Specs Types

### 1. individualPages

In this type, each endpoint has its own dedicated page. The crawler visits each page and extracts the endpoint and its description.

#### Examples
- [Mastodon API Documentation](https://docs.joinmastodon.org/methods/accounts/) - Individual pages with multiple endpoints on each page
- [Alchemy API Documentation](https://docs.alchemy.com/reference/creating-a-subgraph) - Individual pages with a single endpoint on each page

#### Supported Parameters
- `globs`: List of globs to include in the crawling. Default: `[]`
- `globs_exclude`: List of globs to exclude from the crawling. Default: `[]`
- `selectors.name`: In case of individual pages with multiple endpoints, this selector is used to extract the endpoint name.
- `selectors.delimiter`: In case of individual pages with multiple endpoints, this delimiter is used to split the endpoint section.

### 2. singlePage

In this type, all endpoints are listed on a single page. The crawler visits the page and extracts the endpoints and their descriptions.

#### Examples
- [ClickSend API Documentation](https://developers.clicksend.com/docs/rest/v3/)
- [Web Scraper Cloud API Documentation](https://webscraper.io/documentation/web-scraper-cloud/api)

#### Supported Parameters
- `selectors.name`: Selector to extract the endpoint name.
- `selectors.delimiter`: Delimiter to split the endpoint section.

### 3. singlePageSections

In this type, all endpoints are listed on a single page but divided into sections. The crawler visits the page and extracts the endpoints and their descriptions.

#### Examples
- [Mux API Reference](https://docs.mux.com/api-reference)
- [Recharge Payments API Documentation](https://developer.rechargepayments.com/2021-11)

#### Supported Parameters
- `selectors.section`: Selector to extract the section name.
- `selectors.delimiter`: Selector to extract the endpoint name.
