#!/usr/bin/env node
/**
 * Debug script: open Parauapebas diário site with Playwright and dump DOM structure
 * so we can fix the Instar spider selectors.
 *
 * Usage: npx tsx scripts/debug-parauapebas-dom.ts
 */

import { chromium } from "playwright";

const URL = "https://diario.parauapebas.pa.gov.br";

async function main() {
  console.log("Launching browser...");
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    console.log("Navigating to", URL);
    await page.goto(URL, { waitUntil: "networkidle", timeout: 30000 });
    await page.waitForTimeout(5000);

    // Check if there's an iframe
    const iframes = await page.$$("iframe");
    console.log("Iframes count:", iframes.length);
    if (iframes.length > 0) {
      const frameSrcs = await Promise.all(
        iframes.map((f) => f.getAttribute("src")),
      );
      console.log("Iframe srcs:", frameSrcs);
    }

    // Get body innerHTML length and a snippet
    const bodyInfo = await page.evaluate(() => {
      const body = document.body;
      const html = body ? body.innerHTML : "";
      return {
        length: html.length,
        snippet: html.slice(0, 3000),
        hasResultadosDaBusca:
          body?.innerText?.includes("Resultados da Busca") ?? false,
        allClassNames: Array.from(
          new Set(
            Array.from(document.querySelectorAll("*"))
              .map((el) => el.className)
              .filter(Boolean),
          ),
        ).slice(0, 80),
        allIds: Array.from(
          new Set(
            Array.from(document.querySelectorAll("[id]")).map((el) => el.id),
          ),
        ).slice(0, 50),
      };
    });
    console.log("\n--- Body info ---");
    console.log("Body HTML length:", bodyInfo.length);
    console.log(
      'Has "Resultados da Busca" in text:',
      bodyInfo.hasResultadosDaBusca,
    );
    console.log("Sample class names:", bodyInfo.allClassNames);
    console.log("Sample ids:", bodyInfo.allIds);
    console.log("\n--- HTML snippet (first 3000 chars) ---\n");
    console.log(bodyInfo.snippet);

    // Try to find date + link pairs (search results style) - use pure JS to avoid page globals
    const searchResultItems = await page.evaluate(() => {
      const dateRe = /\b(\d{2})\/(\d{2})\/(\d{4})\b/g;
      const out: {
        date: string;
        tagName: string;
        className: string;
        htmlSnippet: string;
        linkHref: string | null;
      }[] = [];
      const cards = document.querySelectorAll(
        ".card.pdf-preview, .document-wrapper .card, .card.shadow-sm",
      );
      for (let i = 0; i < Math.min(cards.length, 15); i++) {
        const card = cards[i];
        const text = card.textContent || "";
        const dateM = text.match(dateRe);
        if (!dateM) continue;
        const link = card.querySelector("a[href]");
        const href = link ? link.getAttribute("href") : null;
        out.push({
          date: dateM[0],
          tagName: card.tagName,
          className:
            (typeof card.className === "string" ? card.className : "") || "",
          htmlSnippet: card.outerHTML.substring(0, 500),
          linkHref: href,
        });
      }
      return out;
    });
    console.log("\n--- Search result style items (date + link) ---");
    console.log(JSON.stringify(searchResultItems, null, 2));

    // If content might be in iframe, try to get frame content
    if (iframes.length > 0) {
      const frame = iframes[0];
      const frameContent = await frame.contentFrame();
      if (frameContent) {
        const frameBody = await frameContent.evaluate(() => {
          const body = document.body;
          return body
            ? {
                length: body.innerHTML.length,
                text: body.innerText?.slice(0, 2000),
              }
            : null;
        });
        console.log("\n--- First iframe body ---");
        console.log(frameBody);
      }
    }
  } finally {
    await browser.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
