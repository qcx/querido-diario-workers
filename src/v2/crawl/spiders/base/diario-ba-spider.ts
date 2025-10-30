import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider para o Diário Oficial BA
 * 
 * Este spider coleta diários oficiais do sistema centralizado da Bahia
 * que cobre aproximadamente 408 municípios do estado.
 * 
 * URL: https://www.diariooficialba.com.br/
 * Gerenciamento: ICP Brasil / Rede Geral
 * Tipo: Sistema próprio (não é SIGPub)
 */

interface DiarioBaConfig {
  url: string;
  cityName: string;
}

export class DiarioBaSpider extends BaseSpider {
  protected diarioBaConfig: DiarioBaConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.diarioBaConfig = spiderConfig.config as DiarioBaConfig;
    logger.info(`Initializing DiarioBaSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling Diário Oficial BA for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // O site usa um sistema de busca com POST
      // Vamos tentar buscar por município e período
      const searchUrl = this.buildSearchUrl();
      logger.debug(`Search URL: ${searchUrl}`);

      // Fazer requisição
      const html = await this.fetch(searchUrl);
      const $ = this.loadHTML(html);

      // Extrair links de PDFs dos resultados
      // O site pode usar diferentes padrões de links
      const pdfLinks = $('a[href*=".pdf"], a[href*="visualizar"], a[href*="download"]');
      for (let i = 0; i < pdfLinks.length; i++) {
        const element = pdfLinks[i];
        const href = $(element).attr('href');
        if (!href) continue;

        // Construir URL completa
        const pdfUrl = href.startsWith('http') 
          ? href 
          : `${this.diarioBaConfig.url.replace(/\/$/, '')}/${href.replace(/^\//, '')}`;

        // Tentar extrair data do link ou texto próximo
        const linkText = $(element).text().trim();
        const parentText = $(element).parent().text().trim();
        const combinedText = `${linkText} ${parentText}`;

        // Buscar padrões de data: DD/MM/YYYY ou YYYY-MM-DD
        const dateMatch = combinedText.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})|(\d{4})[\/\-](\d{2})[\/\-](\d{2})/);
        
        if (dateMatch) {
          let gazetteDate: Date;
          
          if (dateMatch[1]) {
            // Formato DD/MM/YYYY
            const [, day, month, year] = dateMatch;
            gazetteDate = new Date(`${year}-${month}-${day}`);
          } else {
            // Formato YYYY-MM-DD
            const [, , , , year, month, day] = dateMatch;
            gazetteDate = new Date(`${year}-${month}-${day}`);
          }

          if (this.isInDateRange(gazetteDate)) {
            // Extrair número da edição se disponível
            const editionMatch = combinedText.match(/(?:edição|edicao|ed\.?)\s*(?:n[°º]?)?\s*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;

            // Verificar se é edição extraordinária
            const isExtra = /extraordin[aá]ri[ao]|extra|suplementar/i.test(combinedText);

            // Detectar poder (executivo/legislativo)
            let power: 'executive' | 'legislative' | 'executive_legislative' = 'executive';
            if (/c[aâ]mara/i.test(combinedText)) {
              power = 'legislative';
            }

            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber,
              isExtraEdition: isExtra,
              power,
              sourceText: 'Diário Oficial BA'
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        }
      }

      // Se não encontrou nenhuma gazette, tentar abordagem alternativa
      if (gazettes.length === 0) {
        logger.warn(`No gazettes found with standard approach, trying alternative...`);
        // Aqui poderia implementar lógica alternativa de scraping
      }

      logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Constrói URL de busca para o Diário Oficial BA
   */
  private buildSearchUrl(): string {
    const baseUrl = this.diarioBaConfig.url;
    const cityName = encodeURIComponent(this.diarioBaConfig.cityName);
    
    // Formato de data: DD/MM/YYYY
    const startDateStr = this.formatDate(this.startDate);
    const endDateStr = this.formatDate(this.endDate);

    // URL de busca do Diário Oficial BA
    // Nota: A estrutura exata pode precisar ser ajustada após testes
    // Possíveis formatos:
    // - ?cidade=NOME&dataInicio=DD/MM/YYYY&dataFim=DD/MM/YYYY
    // - /busca?q=NOME&di=DD/MM/YYYY&df=DD/MM/YYYY
    return `${baseUrl}?cidade=${cityName}&dataInicio=${startDateStr}&dataFim=${endDateStr}`;
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
