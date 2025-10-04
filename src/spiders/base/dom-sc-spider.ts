import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, DomScConfig } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider para o DOM/SC - Diário Oficial dos Municípios de Santa Catarina
 * 
 * Este spider coleta diários oficiais do sistema centralizado de SC que cobre
 * todos os 295 municípios do estado através de uma única plataforma.
 * 
 * URL: https://diariomunicipal.sc.gov.br/
 * Gerenciamento: Consórcio CIGA (Consórcio de Inovação na Gestão Pública)
 */
export class DomScSpider extends BaseSpider {
  protected domScConfig: DomScConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.domScConfig = spiderConfig.config as DomScConfig;
    logger.info(`Initializing DomScSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling DOM/SC for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Construir URL de busca
      const searchUrl = this.buildSearchUrl();
      logger.debug(`Search URL: ${searchUrl}`);

      // Fazer requisição
      const html = await this.fetch(searchUrl);
      const $ = this.loadHTML(html);

      // Extrair links de PDFs
      // O DOM/SC usa links diretos para PDFs de edições
      $('a[href*=".pdf"]').each((_, element) => {
        const href = $(element).attr('href');
        if (!href) return;

        // Construir URL completa se necessário
        const pdfUrl = href.startsWith('http') 
          ? href 
          : `${this.domScConfig.url}${href}`;

        // Tentar extrair data do link ou texto
        const linkText = $(element).text().trim();
        const dateMatch = linkText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
        
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);

          if (this.isInDateRange(gazetteDate)) {
            // Extrair número da edição se disponível
            const editionMatch = linkText.match(/(?:edição|edicao)\s*(?:n[°º]?)?\s*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;

            // Verificar se é edição extraordinária
            const isExtra = /extraordin[aá]ri[ao]/i.test(linkText);

            gazettes.push(this.createGazette(gazetteDate, pdfUrl, {
              editionNumber,
              isExtraEdition: isExtra,
              power: 'executive',
              sourceText: 'DOM/SC - Diário Oficial dos Municípios de Santa Catarina'
            }));
          }
        }
      });

      logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Constrói URL de busca para o DOM/SC
   */
  private buildSearchUrl(): string {
    const baseUrl = this.domScConfig.url;
    const entityName = encodeURIComponent(this.domScConfig.entityName);
    
    // Formato de data: DD/MM/YYYY
    const startDateStr = this.formatDate(this.startDate);
    const endDateStr = this.formatDate(this.endDate);

    // URL de busca do DOM/SC
    // Exemplo: https://diariomunicipal.sc.gov.br/?r=site/index&q=Prefeitura+Municipal+de+Florianópolis&data_inicio=01/01/2025&data_fim=31/12/2025
    return `${baseUrl}?r=site/index&q=${entityName}&data_inicio=${startDateStr}&data_fim=${endDateStr}`;
  }

  /**
   * Formata data no padrão DD/MM/YYYY
   */
  private formatDate(date: Date): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }
}
