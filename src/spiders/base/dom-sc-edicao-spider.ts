import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, DomScEdicaoConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider para o DOM/SC - Diário Oficial dos Municípios de Santa Catarina
 *
 * Coleta diários oficiais do sistema centralizado DOM/SC para cada município.
 *
 * Estratégia (HTTP-only, sem browser):
 *
 *   1. Para cada data no range, tenta obter a Edição Ordinária compilada por município:
 *      ?r=site/edicoes&edicao=DD/MM/YYYY&cod_municipio={municipioId}
 *      → Se encontrar PDF em edicao.dom.sc.gov.br, retorna esse gazette.
 *
 *   2. Caso não haja edição per-município, coleta autopublicações individuais:
 *      a) Acessa a página do município: ?r=pesquisa/municipio&id={municipioId}&data=YYYY-MM-DD
 *      b) Extrai links de entidades: ?r=pesquisa/entidade&id={entityId}&data=YYYY-MM-DD
 *      c) Em cada entidade, extrai links: ?r=site/autopublicacaoAssinado&id={actId}
 *      d) Cada link é um PDF assinado do ato oficial.
 *
 * URL: https://diariomunicipal.sc.gov.br/
 * Gerenciamento: Consórcio CIGA
 */
export class DomScEdicaoSpider extends BaseSpider {
  protected edicaoConfig: DomScEdicaoConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.edicaoConfig = spiderConfig.config as DomScEdicaoConfig;
    logger.info(
      `Initializing DomScEdicaoSpider for ${this.edicaoConfig.municipioName} (municipioId=${this.edicaoConfig.municipioId})`
    );
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(
      `Crawling DOM/SC for ${this.edicaoConfig.municipioName}...`
    );
    const gazettes: Gazette[] = [];

    const currentDate = new Date(this.startDate);
    while (currentDate <= this.endDate) {
      try {
        const dateGazettes = await this.crawlDate(new Date(currentDate));
        gazettes.push(...dateGazettes);
      } catch (error) {
        logger.warn(
          `Error crawling ${this.edicaoConfig.municipioName} on ${this.formatDateISO(currentDate)}: ${(error as Error).message}`
        );
      }
      currentDate.setDate(currentDate.getDate() + 1);
    }

    logger.info(
      `Found ${gazettes.length} gazettes for ${this.edicaoConfig.municipioName}`
    );
    return gazettes;
  }

  /**
   * Crawl a single date: first try Edição Ordinária, then autopublicações.
   */
  private async crawlDate(date: Date): Promise<Gazette[]> {
    // Strategy 1: Try per-municipality Edição Ordinária (single compiled PDF)
    const edicaoGazette = await this.tryEdicaoOrdinaria(date);
    if (edicaoGazette) {
      return [edicaoGazette];
    }

    // Strategy 2: Collect individual autopublicação acts via entity pages
    return this.collectAutopublicacoes(date);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Strategy 1: Edição Ordinária per municipality
  // ─────────────────────────────────────────────────────────────────────────

  private async tryEdicaoOrdinaria(date: Date): Promise<Gazette | null> {
    const dateStr = this.formatDateDDMMYYYY(date);
    const url = `${this.edicaoConfig.baseUrl}?r=site/edicoes&edicao=${encodeURIComponent(dateStr)}&cod_municipio=${this.edicaoConfig.municipioId}`;

    logger.debug(`Trying Edição Ordinária: ${url}`);

    try {
      const html = await this.fetch(url);
      const $ = this.loadHTML(html);

      // Check for "Nenhum resultado" (no edition for this municipality)
      if (html.includes('Nenhum resultado encontrado')) {
        logger.debug(
          `No per-municipality edition for ${this.edicaoConfig.municipioName} on ${dateStr}`
        );
        return null;
      }

      // Find PDF link hosted at edicao.dom.sc.gov.br
      let pdfUrl: string | undefined;
      const edicaoLinks = $('a[href*="edicao.dom.sc.gov.br"]');
      for (let i = 0; i < edicaoLinks.length; i++) {
        const href = $(edicaoLinks[i]).attr('href');
        if (href && href.endsWith('.pdf')) {
          pdfUrl = href;
          break;
        }
      }

      if (!pdfUrl) {
        return null;
      }

      // Extract edition number from URL pattern: _edicao_{municipioId}_{editionNumber}_assinada.pdf
      const editionMatch = pdfUrl.match(/_edicao_\d+_(\d+)_assinada\.pdf$/);
      const editionNumber = editionMatch ? editionMatch[1] : undefined;

      logger.debug(
        `Found Edição Ordinária PDF for ${this.edicaoConfig.municipioName}: ${pdfUrl}`
      );

      return this.createGazette(date, pdfUrl, {
        editionNumber,
        isExtraEdition: false,
        power: 'executive_legislative',
        sourceText: `DOM/SC - Edição Ordinária - ${this.edicaoConfig.municipioName}`,
        skipUrlResolution: true,
      });
    } catch (error) {
      logger.debug(
        `Edição Ordinária fetch failed for ${this.edicaoConfig.municipioName} on ${dateStr}: ${(error as Error).message}`
      );
      return null;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Strategy 2: Autopublicações via entity pages
  // ─────────────────────────────────────────────────────────────────────────

  private async collectAutopublicacoes(date: Date): Promise<Gazette[]> {
    const dateISO = this.formatDateISO(date);
    const municipioUrl = `${this.edicaoConfig.baseUrl}?r=pesquisa/municipio&id=${this.edicaoConfig.municipioId}&data=${dateISO}`;

    logger.debug(`Fetching municipality page: ${municipioUrl}`);

    let html: string;
    try {
      html = await this.fetch(municipioUrl);
    } catch (error) {
      logger.debug(
        `Municipality page fetch failed for ${this.edicaoConfig.municipioName} on ${dateISO}: ${(error as Error).message}`
      );
      return [];
    }

    const $ = this.loadHTML(html);

    // Extract entity links: ?r=pesquisa/entidade&id={entityId}&data=YYYY-MM-DD
    const entityIds: number[] = [];
    const entityLinks = $('a[href*="pesquisa/entidade"]');
    for (let i = 0; i < entityLinks.length; i++) {
      const href = $(entityLinks[i]).attr('href') || '';
      const match = href.match(/id=(\d+)/);
      if (match) {
        entityIds.push(parseInt(match[1], 10));
      }
    }

    if (entityIds.length === 0) {
      logger.debug(
        `No entities found for ${this.edicaoConfig.municipioName} on ${dateISO}`
      );
      return [];
    }

    logger.debug(
      `Found ${entityIds.length} entities for ${this.edicaoConfig.municipioName} on ${dateISO}`
    );

    // For each entity, collect autopublicação act PDFs
    const gazettes: Gazette[] = [];
    for (const entityId of entityIds) {
      const entityGazettes = await this.collectEntityAutopublicacoes(
        date,
        entityId
      );
      gazettes.push(...entityGazettes);
    }

    logger.debug(
      `Collected ${gazettes.length} autopublicação acts for ${this.edicaoConfig.municipioName} on ${dateISO}`
    );
    return gazettes;
  }

  private async collectEntityAutopublicacoes(
    date: Date,
    entityId: number
  ): Promise<Gazette[]> {
    const dateISO = this.formatDateISO(date);
    const entityUrl = `${this.edicaoConfig.baseUrl}?r=pesquisa/entidade&id=${entityId}&data=${dateISO}`;

    let html: string;
    try {
      html = await this.fetch(entityUrl);
    } catch (error) {
      logger.debug(
        `Entity page ${entityId} fetch failed: ${(error as Error).message}`
      );
      return [];
    }

    const $ = this.loadHTML(html);
    const gazettes: Gazette[] = [];

    // Extract autopublicação PDF links: ?r=site/autopublicacaoAssinado&id={actId}
    const autopubLinks = $('a[href*="autopublicacaoAssinado"]');
    for (let i = 0; i < autopubLinks.length; i++) {
      const href = $(autopubLinks[i]).attr('href') || '';
      const match = href.match(/id=(\d+)/);
      if (match) {
        const actId = match[1];
        const pdfUrl = `${this.edicaoConfig.baseUrl}?r=site/autopublicacaoAssinado&id=${actId}`;

        const gazette = await this.createGazette(date, pdfUrl, {
          isExtraEdition: false,
          power: 'executive_legislative',
          sourceText: `DOM/SC - Autopublicação - ${this.edicaoConfig.municipioName}`,
          // Don't skip URL resolution: autopublicacaoAssinado redirects (302) to the actual PDF
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      }
    }

    return gazettes;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────────────────────

  private formatDateDDMMYYYY(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  private formatDateISO(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${year}-${month}-${day}`;
  }
}
