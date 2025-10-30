import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange } from '../../types';
import { logger } from '../../utils/logger';

/**
 * Spider para o AMM-MT - Jornal Oficial da Associação Mato-grossense dos Municípios
 * 
 * Este spider coleta diários oficiais do sistema da AMM-MT que complementa
 * a cobertura do SIGPub em Mato Grosso.
 * 
 * URL: https://amm.diariomunicipal.org/
 * Gerenciamento: Associação Mato-grossense dos Municípios
 * Tipo: Sistema próprio (não é SIGPub padrão)
 */

interface AmmMtConfig {
  url: string;
  cityName: string;
}

export class AmmMtSpider extends BaseSpider {
  protected ammMtConfig: AmmMtConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.ammMtConfig = spiderConfig.config as AmmMtConfig;
    logger.info(`Initializing AmmMtSpider for ${spiderConfig.name}`);
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling AMM-MT for ${this.spiderConfig.name}...`);
    const gazettes: Gazette[] = [];

    try {
      // Construir URL de busca
      const searchUrl = this.buildSearchUrl();
      logger.debug(`Search URL: ${searchUrl}`);

      // Fazer requisição
      const html = await this.fetch(searchUrl);
      const $ = this.loadHTML(html);

      // O AMM-MT tem uma interface de busca de publicações
      // Extrair links de PDFs das edições
      const pdfLinks: Array<{ href: string; linkText: string; parentText: string }> = [];
      $('a[href*=".pdf"], a[href*="edicao"], a[href*="publicacao"]').each((_, element) => {
        const href = $(element).attr('href');
        if (href) {
          pdfLinks.push({
            href,
            linkText: $(element).text().trim(),
            parentText: $(element).parent().text().trim()
          });
        }
      });

      for (const { href, linkText, parentText } of pdfLinks) {
        // Construir URL completa
        const pdfUrl = href.startsWith('http') 
          ? href 
          : `${this.ammMtConfig.url.replace(/\/$/, '')}/${href.replace(/^\//, '')}`;

        // Tentar extrair data do link ou texto
        const combinedText = `${linkText} ${parentText}`;

        // Buscar padrões de data: DD/MM/YYYY
        const dateMatch = combinedText.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
        
        if (dateMatch) {
          const [, day, month, year] = dateMatch;
          const gazetteDate = new Date(`${year}-${month}-${day}`);

          if (this.isInDateRange(gazetteDate)) {
            // Extrair número da edição se disponível
            const editionMatch = combinedText.match(/(?:edição|edicao|ed\.?)\s*(?:n[°º]?)?\s*(\d+)/i);
            const editionNumber = editionMatch ? editionMatch[1] : undefined;

            // Verificar se é edição extraordinária
            const isExtra = /extraordin[aá]ri[ao]|extra|suplementar/i.test(combinedText);

            // Detectar poder
            let power: 'executive' | 'legislative' | 'executive_legislative' = 'executive';
            if (/c[aâ]mara/i.test(combinedText)) {
              power = 'legislative';
            } else if (/prefeitura/i.test(combinedText)) {
              power = 'executive';
            }

            const gazette = await this.createGazette(gazetteDate, pdfUrl, {
              editionNumber,
              isExtraEdition: isExtra,
              power,
              sourceText: 'Jornal Oficial AMM-MT'
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        }
      }

      // Tentar abordagem alternativa: buscar por edições diárias
      if (gazettes.length === 0) {
        logger.debug('Trying alternative approach for AMM-MT...');
        
        // O site pode ter links para edições do dia
        const altLinks: Array<{ href: string; text: string }> = [];
        $('a').each((_, element) => {
          const href = $(element).attr('href');
          const text = $(element).text().trim().toLowerCase();
          if (href && (text.includes('baixar') || text.includes('edição') || text.includes('edicao'))) {
            altLinks.push({ href, text });
          }
        });

        for (const { href } of altLinks) {
          const pdfUrl = href.startsWith('http') 
            ? href 
            : `${this.ammMtConfig.url.replace(/\/$/, '')}/${href.replace(/^\//, '')}`;
          
          // Usar data atual como fallback
          const today = new Date();
          if (this.isInDateRange(today)) {
            const gazette = await this.createGazette(today, pdfUrl, {
              power: 'executive_legislative',
              sourceText: 'Jornal Oficial AMM-MT'
            });
            
            if (gazette) {
              gazettes.push(gazette);
            }
          }
        }
      }

      logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, error as Error);
    }

    return gazettes;
  }

  /**
   * Constrói URL de busca para o AMM-MT
   */
  private buildSearchUrl(): string {
    const baseUrl = this.ammMtConfig.url;
    const cityName = encodeURIComponent(this.ammMtConfig.cityName);
    
    // Formato de data: DD/MM/YYYY
    const startDateStr = this.formatDate(this.startDate);
    const endDateStr = this.formatDate(this.endDate);

    // URL de busca do AMM-MT
    // Formato observado: /publicacoes com filtros
    return `${baseUrl}publicacoes?entidade=${cityName}&dataInicio=${startDateStr}&dataFim=${endDateStr}`;
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
