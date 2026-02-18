import puppeteer from "@cloudflare/puppeteer";
import { logger } from "../src/utils/logger";

async function debugPortoAlegre() {
  let browser = null;
  let page = null;

  try {
    console.log("Launching browser...");
    browser = await puppeteer.launch({
      args: ["--allow-no-sandbox-job", "--disable-gpu"],
    });

    page = await browser.newPage();

    const targetUrl = "https://dopa.portoalegre.rs.gov.br/";
    console.log(`Navigating to: ${targetUrl}`);

    await page.goto(targetUrl, {
      waitUntil: "networkidle0",
      timeout: 30000,
    });

    console.log("Page loaded, waiting for content...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Get page title
    const title = await page.title();
    console.log(`Page title: ${title}`);

    // Try to find search/list elements
    const pageContent = await page.content();

    // Log what we can find
    console.log("\n=== Checking for gazette listing elements ===");

    // Check for various listing structures
    const hasTable = await page.$("#search-results table") ||
      (await page.$$("table")).length > 0;
    console.log(`Has table: ${hasTable}`);

    const hasList = await page.$("ul") || (await page.$$("li")).length > 0;
    console.log(`Has list elements: ${hasList}`);

    const hasArticles = (await page.$$("article")).length > 0;
    console.log(`Has article elements: ${hasArticles}`);

    // Check for dof_publicacao_diario (Instar format)
    const hasDof = (await page.$$(".dof_publicacao_diario")).length > 0;
    console.log(`Has .dof_publicacao_diario: ${hasDof}`);

    // Check for documents
    const hasDocuments = (await page.$$("[class*='document']")).length > 0;
    console.log(`Has document elements: ${hasDocuments}`);

    // Look for input/search fields
    const searchInputs = await page.$$("input[type='text'], input[type='search']");
    console.log(`Search inputs found: ${searchInputs.length}`);

    if (searchInputs.length > 0) {
      for (let i = 0; i < searchInputs.length; i++) {
        const placeholder = await page.evaluate(
          (el: any) => el.placeholder || el.id || el.name,
          searchInputs[i]
        );
        console.log(`  - Input ${i}: ${placeholder}`);
      }
    }

    // Look for date inputs
    const dateInputs = await page.$$("input[type='date']");
    console.log(`Date inputs found: ${dateInputs.length}`);

    // Look for buttons
    const buttons = await page.$$("button");
    console.log(`Buttons found: ${buttons.length}`);

    if (buttons.length > 0) {
      for (let i = 0; i < Math.min(5, buttons.length); i++) {
        const text = await page.evaluate((el: any) => el.innerText, buttons[i]);
        console.log(`  - Button: "${text}"`);
      }
    }

    // Try to get page structure
    console.log("\n=== Page Structure ===");
    const structure = await page.evaluate(() => {
      const root = document.querySelector("app-root") || document.body;
      const children = root.children;
      const result: any[] = [];
      for (let i = 0; i < Math.min(5, children.length); i++) {
        result.push({
          tag: children[i].tagName,
          class: children[i].className,
          id: children[i].id,
          text: (children[i] as any).innerText
            ?.substring(0, 100)
            .replace(/\n/g, " "),
        });
      }
      return result;
    });

    console.log(JSON.stringify(structure, null, 2));

    // Check for iframes
    const iframes = await page.$$("iframe");
    console.log(`\nIframes found: ${iframes.length}`);

    // Take a screenshot
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const screenshotPath = `debug-porto-alegre-${timestamp}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`Screenshot saved to: ${screenshotPath}`);

    // Look for any text with "edição" or "diário"
    const gazettePattern = await page.evaluate(() => {
      const text = document.body.innerText;
      const matches = text.match(/(edição|diário|publicação|decreto)/gi) || [];
      return {
        count: matches.length,
        sample: matches.slice(0, 5),
      };
    });

    console.log(
      `\nFound gazette-related words: ${gazettePattern.count}`,
      gazettePattern.sample
    );

    // Save raw HTML to file for inspection
    const htmlPath = `debug-porto-alegre-${timestamp}.html`;
    const html = await page.content();
    console.log(`\nHTML saved to: ${htmlPath}`);
    console.log(`HTML length: ${html.length} characters`);

    // Save just the rendered content
    const renderedContent = await page.evaluate(() => {
      return document.documentElement.outerHTML;
    });
    const renderedPath = `debug-porto-alegre-rendered-${timestamp}.html`;
    console.log(`Rendered HTML saved to: ${renderedPath}`);
    console.log(`Rendered HTML length: ${renderedContent.length} characters`);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    if (page) await page.close();
    if (browser) await browser.close();
  }
}

debugPortoAlegre();
