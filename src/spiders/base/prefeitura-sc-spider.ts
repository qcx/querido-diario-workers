import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, PrefeituraScCityConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider genérico para diários oficiais no site próprio das prefeituras de SC
 * (sem usar o DOM/SC). Faz GET em baseUrl + diarioPath e procura links .pdf com datas.
 */
export class PrefeituraScSpider extends BaseSpider {
  protected scConfig: PrefeituraScCityConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.scConfig = spiderConfig.config as PrefeituraScCityConfig;
    if (!this.scConfig.baseUrl) {
      throw new Error(`PrefeituraScSpider requires baseUrl for ${spiderConfig.name}`);
    }
    logger.info(`Initializing PrefeituraScSpider for ${spiderConfig.name} (${this.scConfig.baseUrl})`);
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];
    const base = this.scConfig.baseUrl.replace(/\/$/, '');
    const diarioPath = (this.scConfig.diarioPath || '').replace(/^\//, '');
    const urlsToTry = diarioPath
      ? [`${base}/${diarioPath}`, `${base}/${diarioPath}/`]
      : [base, `${base}/diario-oficial`, `${base}/jornal`, `${base}/doe`, `${base}/publicacoes-no-diario-oficial`];

    const seenUrls = new Set<string>();

    for (const url of urlsToTry) {
      try {
        const html = await this.fetch(url);
        const pdfRegex = /href=["']([^"']*\.pdf)["']/gi;
        const dateRegex = /(\d{2})\/(\d{2})\/(\d{4})/g;
        let match;

        while ((match = pdfRegex.exec(html)) !== null) {
          let href = match[1];
          if (!href.startsWith('http')) {
            href = href.startsWith('/') ? `${new URL(base).origin}${href}` : `${url.replace(/\/?$/, '/')}${href}`;
          }
          if (seenUrls.has(href)) continue;
          seenUrls.add(href);

          const start = Math.max(0, match.index - 300);
          const end = Math.min(html.length, match.index + 300);
          const context = html.slice(start, end);
          const dateMatch = context.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) continue;

          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          if (!this.isInDateRange(gazetteDate)) continue;

          const gazette = await this.createGazette(gazetteDate, href, {
            power: 'executive',
            sourceText: this.spiderConfig.name,
          });
          if (gazette) gazettes.push(gazette);
        }

        // Também procurar links que não são .pdf mas podem levar ao PDF (ex: página de edição)
        const viewLinkRegex = /href=["']([^"']*(?:edicao|edition|jornal|diario|publicacao|visualizar|download)[^"']*)["']/gi;
        while ((match = viewLinkRegex.exec(html)) !== null) {
          let href = match[1];
          if (href.startsWith('javascript:') || href.includes('#')) continue;
          if (!href.startsWith('http')) {
            href = href.startsWith('/') ? `${new URL(base).origin}${href}` : `${url.replace(/\/?$/, '/')}${href}`;
          }
          if (seenUrls.has(href)) continue;

          const start = Math.max(0, match.index - 200);
          const end = Math.min(html.length, match.index + 200);
          const context = html.slice(start, end);
          const dateMatch = context.match(/(\d{2})\/(\d{2})\/(\d{4})/);
          if (!dateMatch) continue;

          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);
          if (!this.isInDateRange(gazetteDate)) continue;

          const pdfUrl = await this.resolvePdfFromPage(href, base);
          if (pdfUrl && !seenUrls.has(pdfUrl)) {
            seenUrls.add(pdfUrl);
            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              power: 'executive',
              sourceText: this.spiderConfig.name,
            });
            if (gazette) gazettes.push(gazette);
          }
        }

        if (gazettes.length > 0) break;
      } catch (e) {
        logger.debug(`PrefeituraScSpider: ${url} failed: ${(e as Error).message}`);
      }
    }

    logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    return gazettes;
  }

  private async resolvePdfFromPage(pageUrl: string, base: string): Promise<string | null> {
    try {
      const html = await this.fetch(pageUrl);
      const m = html.match(/href=["']([^"']*\.pdf)["']/i);
      if (m) {
        let u = m[1];
        if (!u.startsWith('http')) u = new URL(u, pageUrl).toString();
        return u;
      }
    } catch {
      // ignore
    }
    return null;
  }
}
