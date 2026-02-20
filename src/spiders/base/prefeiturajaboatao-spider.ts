import puppeteer from "@cloudflare/puppeteer";
import { BaseSpider } from "./base-spider";
import { SpiderConfig, Gazette, DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { toISODate, getCurrentTimestamp } from "../../utils/date-utils";

/**
 * Configuration for Jaboatão dos Guararapes spider
 */
export interface PrefeituraJaboataoConfig {
  type: "prefeiturajaboatao";
  /** Base URL for the diário oficial portal */
  baseUrl: string;
}

/**
 * PrefeituraJaboataoSpider implementation
 *
 * Crawls the WordPress-based Diário Oficial portal for Jaboatão dos Guararapes - PE.
 * The portal uses a standard WordPress structure with posts following the pattern:
 * /YYYY/MM/DD/titulo-da-edicao/
 *
 * Uses Cloudflare Browser Rendering (Puppeteer) to handle Cloudflare protection.
 * Falls back to direct fetch if browser is not available (may not work if Cloudflare is active).
 *
 * Example: https://diariooficial.jaboatao.pe.gov.br/2025/02/13/13-de-fevereiro-de-2025-xxxiv-no-33-jaboatao-dos-guararapes/
 *
 * Each post contains embedded PDF links for the gazette editions.
 */
export class PrefeituraJaboataoSpider extends BaseSpider {
  private readonly wpConfig: PrefeituraJaboataoConfig;
  private readonly baseUrl: string;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.wpConfig = spiderConfig.config as PrefeituraJaboataoConfig;
    this.baseUrl =
      this.wpConfig.baseUrl || "https://diariooficial.jaboatao.pe.gov.br";

    logger.info(
      `Initializing PrefeituraJaboataoSpider for ${spiderConfig.name}`,
    );
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling Jaboatão dos Guararapes from ${toISODate(this.startDate)} to ${toISODate(this.endDate)}...`,
    );

    if (this.browser) {
      return this.crawlWithBrowser();
    }

    // Fallback to fetch if browser not available
    logger.info(
      "Browser not available, trying direct fetch (may fail with Cloudflare)",
    );
    return this.crawlWithFetch();
  }

  /**
   * Crawl using direct HTTP fetch (fallback when browser is not available)
   */
  private async crawlWithFetch(): Promise<Gazette[]> {
    try {
      const response = await fetch(this.baseUrl, {
        method: "GET",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        logger.error(
          `Failed to fetch Jaboatão page: ${response.status} ${response.statusText}`,
        );
        return [];
      }

      const html = await response.text();

      // Check if we hit Cloudflare challenge
      if (html.includes("Just a moment...") || html.includes("_cf_chl_opt")) {
        logger.warn(
          "Cloudflare challenge detected, browser rendering required but not available",
        );
        return [];
      }

      return this.parseHtmlContent(html);
    } catch (error) {
      logger.error(
        `Error crawling Jaboatão dos Guararapes with fetch:`,
        error as Error,
      );
      return [];
    }
  }

  /**
   * Parse HTML content and extract gazette information
   */
  private async parseHtmlContent(html: string): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    // Pattern: /YYYY/MM/DD/titulo/
    const postLinkPattern =
      /href="(https:\/\/diariooficial\.jaboatao\.pe\.gov\.br\/(\d{4})\/(\d{2})\/(\d{2})\/[^"]+)"/gi;
    const matches = [...html.matchAll(postLinkPattern)];

    logger.debug(`Found ${matches.length} potential post links on main page`);

    const startDateStr = toISODate(this.startDate);
    const endDateStr = toISODate(this.endDate);

    // Track unique URLs to avoid duplicates
    const processedUrls = new Set<string>();

    for (const match of matches) {
      const postUrl = match[1];
      const year = match[2];
      const month = match[3];
      const day = match[4];
      const postDate = `${year}-${month}-${day}`;

      // Skip if already processed or outside date range
      if (processedUrls.has(postUrl)) continue;
      if (postDate < startDateStr || postDate > endDateStr) continue;

      processedUrls.add(postUrl);

      try {
        // Fetch the individual post page to find PDF links
        const postResponse = await fetch(postUrl, {
          method: "GET",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          },
        });

        if (!postResponse.ok) {
          logger.warn(
            `Failed to fetch post ${postUrl}: ${postResponse.status}`,
          );
          continue;
        }

        const postHtml = await postResponse.text();

        // Check for Cloudflare on individual page
        if (
          postHtml.includes("Just a moment...") ||
          postHtml.includes("_cf_chl_opt")
        ) {
          logger.warn(`Cloudflare challenge on post ${postUrl}`);
          continue;
        }

        // Extract the title from the page
        const titleMatch = postHtml.match(/<title>([^<]+)<\/title>/i);
        const title = titleMatch
          ? this.decodeHtmlEntities(titleMatch[1].trim())
          : `Diário Oficial - ${day}/${month}/${year}`;

        // Find PDF links in the post
        const pdfPattern = /href="([^"]+\.pdf)"/gi;
        const pdfMatches = [...postHtml.matchAll(pdfPattern)];

        if (pdfMatches.length > 0) {
          // Create gazette for each PDF found
          for (const pdfMatch of pdfMatches) {
            let pdfUrl = pdfMatch[1];

            // Make URL absolute if needed
            if (!pdfUrl.startsWith("http")) {
              pdfUrl = new URL(pdfUrl, this.baseUrl).toString();
            }

            const gazette: Gazette = {
              date: postDate,
              fileUrl: pdfUrl,
              territoryId: this.spiderConfig.territoryId,
              scrapedAt: getCurrentTimestamp(),
              isExtraEdition:
                title.toLowerCase().includes("extraordin") ||
                title.toLowerCase().includes("extra"),
              power: "executive_legislative",
              sourceText: title,
            };

            gazettes.push(gazette);
            logger.info(`Found gazette for ${gazette.date}: ${title}`);
          }
        } else {
          // No PDF found, the post itself is the gazette content (HTML-based)
          const gazette: Gazette = {
            date: postDate,
            fileUrl: postUrl,
            territoryId: this.spiderConfig.territoryId,
            scrapedAt: getCurrentTimestamp(),
            isExtraEdition:
              title.toLowerCase().includes("extraordin") ||
              title.toLowerCase().includes("extra"),
            power: "executive_legislative",
            sourceText: title,
          };

          gazettes.push(gazette);
          logger.info(`Found gazette (HTML) for ${gazette.date}: ${title}`);
        }
      } catch (error) {
        logger.error(`Error processing post ${postUrl}:`, error as Error);
      }
    }

    logger.info(
      `Successfully crawled ${gazettes.length} gazettes from Jaboatão dos Guararapes`,
    );
    return gazettes;
  }

  /**
   * Crawl using Puppeteer browser (handles Cloudflare protection)
   */
  private async crawlWithBrowser(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    let browserInstance: puppeteer.Browser | null = null;

    try {
      browserInstance = await puppeteer.launch(this.browser!);
      const page = await browserInstance.newPage();

      // Set a realistic user agent
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      );

      // Navigate to main page and wait for Cloudflare challenge to complete
      logger.debug("Navigating to Jaboatão portal...");
      await page.goto(this.baseUrl, {
        waitUntil: "networkidle0",
        timeout: 30000,
      });

      // Wait a bit for any JavaScript to finish
      await page
        .waitForSelector('article, .post, .entry-title, a[href*="/20"]', {
          timeout: 15000,
        })
        .catch(() => {
          logger.debug(
            "Waiting for content selectors timed out, continuing anyway",
          );
        });

      const html = await page.content();

      // Pattern: /YYYY/MM/DD/titulo/
      const postLinkPattern =
        /href="(https:\/\/diariooficial\.jaboatao\.pe\.gov\.br\/(\d{4})\/(\d{2})\/(\d{2})\/[^"]+)"/gi;
      const matches = [...html.matchAll(postLinkPattern)];

      logger.debug(`Found ${matches.length} potential post links on main page`);

      const startDateStr = toISODate(this.startDate);
      const endDateStr = toISODate(this.endDate);

      // Track unique URLs to avoid duplicates
      const processedUrls = new Set<string>();

      for (const match of matches) {
        const postUrl = match[1];
        const year = match[2];
        const month = match[3];
        const day = match[4];
        const postDate = `${year}-${month}-${day}`;

        // Skip if already processed or outside date range
        if (processedUrls.has(postUrl)) continue;
        if (postDate < startDateStr || postDate > endDateStr) continue;

        processedUrls.add(postUrl);

        try {
          // Navigate to the individual post page
          logger.debug(`Fetching post: ${postUrl}`);
          await page.goto(postUrl, {
            waitUntil: "networkidle0",
            timeout: 20000,
          });

          const postHtml = await page.content();

          // Extract the title from the page
          const titleMatch = postHtml.match(/<title>([^<]+)<\/title>/i);
          const title = titleMatch
            ? this.decodeHtmlEntities(titleMatch[1].trim())
            : `Diário Oficial - ${day}/${month}/${year}`;

          // Find PDF links in the post
          const pdfPattern = /href="([^"]+\.pdf)"/gi;
          const pdfMatches = [...postHtml.matchAll(pdfPattern)];

          if (pdfMatches.length > 0) {
            // Create gazette for each PDF found
            for (const pdfMatch of pdfMatches) {
              let pdfUrl = pdfMatch[1];

              // Make URL absolute if needed
              if (!pdfUrl.startsWith("http")) {
                pdfUrl = new URL(pdfUrl, this.baseUrl).toString();
              }

              const gazette: Gazette = {
                date: postDate,
                fileUrl: pdfUrl,
                territoryId: this.spiderConfig.territoryId,
                scrapedAt: getCurrentTimestamp(),
                isExtraEdition:
                  title.toLowerCase().includes("extraordin") ||
                  title.toLowerCase().includes("extra"),
                power: "executive_legislative",
                sourceText: title,
              };

              gazettes.push(gazette);
              logger.info(`Found gazette for ${gazette.date}: ${title}`);
            }
          } else {
            // No PDF found, the post itself is the gazette content
            const gazette: Gazette = {
              date: postDate,
              fileUrl: postUrl,
              territoryId: this.spiderConfig.territoryId,
              scrapedAt: getCurrentTimestamp(),
              isExtraEdition:
                title.toLowerCase().includes("extraordin") ||
                title.toLowerCase().includes("extra"),
              power: "executive_legislative",
              sourceText: title,
            };

            gazettes.push(gazette);
            logger.info(`Found gazette (HTML) for ${gazette.date}: ${title}`);
          }
        } catch (error) {
          logger.error(`Error processing post ${postUrl}:`, error as Error);
        }
      }

      // Also try pagination if no gazettes found in the current range
      let pageNum = 2;
      const maxPages = 10;

      while (pageNum <= maxPages && gazettes.length === 0) {
        try {
          const pageUrl = `${this.baseUrl}/page/${pageNum}/`;
          logger.debug(`Fetching pagination page: ${pageUrl}`);

          await page.goto(pageUrl, {
            waitUntil: "networkidle0",
            timeout: 20000,
          });

          const pageHtml = await page.content();
          const pageMatches = [...pageHtml.matchAll(postLinkPattern)];

          if (pageMatches.length === 0) {
            break;
          }

          let foundInRange = false;

          for (const match of pageMatches) {
            const postUrl = match[1];
            const year = match[2];
            const month = match[3];
            const day = match[4];
            const postDate = `${year}-${month}-${day}`;

            if (processedUrls.has(postUrl)) continue;

            // Stop pagination if we've gone past our date range
            if (postDate < startDateStr) {
              logger.debug(
                `Reached posts before date range, stopping pagination`,
              );
              break;
            }

            if (postDate > endDateStr) continue;

            foundInRange = true;
            processedUrls.add(postUrl);

            // Navigate to this post
            try {
              await page.goto(postUrl, {
                waitUntil: "networkidle0",
                timeout: 20000,
              });

              const postHtml = await page.content();
              const titleMatch = postHtml.match(/<title>([^<]+)<\/title>/i);
              const title = titleMatch
                ? this.decodeHtmlEntities(titleMatch[1].trim())
                : `Diário Oficial - ${day}/${month}/${year}`;

              // Find PDF links
              const pdfPattern = /href="([^"]+\.pdf)"/gi;
              const pdfMatches = [...postHtml.matchAll(pdfPattern)];

              if (pdfMatches.length > 0) {
                for (const pdfMatch of pdfMatches) {
                  let pdfUrl = pdfMatch[1];
                  if (!pdfUrl.startsWith("http")) {
                    pdfUrl = new URL(pdfUrl, this.baseUrl).toString();
                  }

                  const gazette: Gazette = {
                    date: postDate,
                    fileUrl: pdfUrl,
                    territoryId: this.spiderConfig.territoryId,
                    scrapedAt: getCurrentTimestamp(),
                    isExtraEdition:
                      title.toLowerCase().includes("extraordin") ||
                      title.toLowerCase().includes("extra"),
                    power: "executive_legislative",
                    sourceText: title,
                  };

                  gazettes.push(gazette);
                  logger.info(`Found gazette for ${gazette.date}: ${title}`);
                }
              } else {
                const gazette: Gazette = {
                  date: postDate,
                  fileUrl: postUrl,
                  territoryId: this.spiderConfig.territoryId,
                  scrapedAt: getCurrentTimestamp(),
                  isExtraEdition:
                    title.toLowerCase().includes("extraordin") ||
                    title.toLowerCase().includes("extra"),
                  power: "executive_legislative",
                  sourceText: title,
                };

                gazettes.push(gazette);
                logger.info(
                  `Found gazette (HTML) for ${gazette.date}: ${title}`,
                );
              }
            } catch (error) {
              logger.error(
                `Error processing paginated post ${postUrl}:`,
                error as Error,
              );
            }
          }

          if (!foundInRange) {
            break;
          }

          pageNum++;
        } catch (error) {
          logger.debug(`Error fetching page ${pageNum}`);
          break;
        }
      }

      logger.info(
        `Successfully crawled ${gazettes.length} gazettes from Jaboatão dos Guararapes`,
      );
    } catch (error) {
      logger.error(`Error crawling Jaboatão dos Guararapes:`, error as Error);
    } finally {
      if (browserInstance) {
        await browserInstance.close();
      }
    }

    return gazettes;
  }

  /**
   * Decode HTML entities in text
   */
  private decodeHtmlEntities(text: string): string {
    return text
      .replace(/&#8211;/g, "-")
      .replace(/&#8212;/g, "-")
      .replace(/&#8216;/g, "'")
      .replace(/&#8217;/g, "'")
      .replace(/&#8220;/g, '"')
      .replace(/&#8221;/g, '"')
      .replace(/&#038;/g, "&")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/ – Diário Oficial.*$/i, "");
  }
}
