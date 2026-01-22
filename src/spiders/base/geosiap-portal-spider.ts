import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, GeosiapPortalConfig } from '../../types';
import { logger } from '../../utils/logger';
import { toISODate } from '../../utils/date-utils';

/**
 * GeosiapPortalSpider - Spider for GeoSIAP Portal de Transparência
 * 
 * This spider uses the Portal de Transparência API to list and download gazettes.
 * 
 * API endpoint for listing:
 * GET /api/default/publicacoes/publicacoes?id_publicacao_tipo=7&id_entidade={entityId}
 * 
 * API endpoint for download:
 * GET /api/default/publicacoes/get_arquivo.anexo?id_publicacao={id}
 * 
 * URL pattern: https://{city}.geosiap.net.br/portal-transparencia/...
 * 
 * Example: https://japeri.geosiap.net.br/portal-transparencia/siapegov.japeri.rj.gov.br/portal-transparencia/publicacoes?id_publicacao_tipo=7
 */

interface GeosiapPortalGazetteItem {
  id_publicacao: string;
  ds_publicacao_tipo: string;
  ds_publicacao_subtipo?: string;
  nome_arquivo: string;
  dt_publicacao: string;
  dt_publicacao_formatado: string;
  exercicio: string;
  periodo?: string;
  tem_historico?: string | null;
  id_publicacao_tipo: string;
  id_publicacao_subtipo?: string;
  id_publicacao_periodo?: string;
  mes?: string | null;
  publicar?: string;
  usuario?: string;
  id_relatorio?: string | null;
}

interface GeosiapPortalApiResponse {
  publicacoes: GeosiapPortalGazetteItem[];
}

export class GeosiapPortalSpider extends BaseSpider {
  private portalConfig: GeosiapPortalConfig;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange) {
    super(spiderConfig, dateRange);
    this.portalConfig = spiderConfig.config as GeosiapPortalConfig;

    if (!this.portalConfig.baseUrl) {
      throw new Error(`GeosiapPortalSpider requires a baseUrl in config for ${spiderConfig.name}`);
    }
    
    logger.info(`Initializing GeosiapPortalSpider for ${spiderConfig.name} with URL: ${this.portalConfig.baseUrl}`);
  }

  /**
   * Extract the base domain from the baseUrl
   * e.g., https://japeri.geosiap.net.br/portal-transparencia/... -> https://japeri.geosiap.net.br
   */
  private extractBaseDomain(): string {
    const url = new URL(this.portalConfig.baseUrl);
    return `${url.protocol}//${url.host}`;
  }

  /**
   * Build the API URL for fetching gazette list
   */
  private buildApiUrl(): string {
    const baseDomain = this.extractBaseDomain();
    const entityId = this.portalConfig.entityId || 10;
    const publicationTypeId = this.portalConfig.publicationTypeId || 7;
    
    // The API endpoint for listing gazettes
    return `${baseDomain}/portal-transparencia/api/default/publicacoes/publicacoes?id_subtipo=0&id_publicacao=0&id_publicacao_tipo=${publicationTypeId}&id_publicacao_sub_tipo=0&id_publicacao_periodo=0&exercicio=0&mes=0&id_relatorio=0&id_entidade=${entityId}`;
  }

  /**
   * Build the download URL for a specific gazette
   */
  private buildDownloadUrl(publicationId: number): string {
    const baseDomain = this.extractBaseDomain();
    return `${baseDomain}/portal-transparencia/api/default/publicacoes/get_arquivo.anexo?id_publicacao=${publicationId}`;
  }

  async crawl(): Promise<Gazette[]> {
    logger.info(`Crawling ${this.portalConfig.baseUrl} using API for ${this.spiderConfig.name}...`);

    const gazettes: Gazette[] = [];

    try {
      const apiUrl = this.buildApiUrl();
      logger.debug(`Fetching gazette list from API: ${apiUrl}`);
      
      const response = await fetch(apiUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; GoodFellow/1.0)'
        }
      });
      
      if (!response.ok) {
        throw new Error(`API request failed with status ${response.status}`);
      }
      
      this.requestCount++;
      const responseData = await response.json() as GeosiapPortalApiResponse;
      
      if (!responseData.publicacoes || !Array.isArray(responseData.publicacoes)) {
        logger.warn(`Unexpected API response format from ${apiUrl}`);
        return gazettes;
      }

      logger.info(`Found ${responseData.publicacoes.length} gazette entries from API`);

      for (const item of responseData.publicacoes) {
        // Parse the publication date
        const date = this.parsePublicationDate(item.dt_publicacao);
        if (!date) {
          logger.warn(`Could not parse date: ${item.dt_publicacao}`);
          continue;
        }

        // Check if date is in range
        if (!this.isInDateRange(date)) {
          continue;
        }

        // Extract edition number from nome_arquivo (filename)
        // e.g., "JAPERI - 6017 - 21 DE JANEIRO DE 2026.pdf" -> "6017"
        const editionNumber = this.extractEditionNumber(item.nome_arquivo);

        // Build the download URL
        const pdfUrl = this.buildDownloadUrl(parseInt(item.id_publicacao));

        // Create gazette
        const gazette = await this.createGazette(date, pdfUrl, {
          editionNumber,
          power: 'executive_legislative',
          sourceText: item.nome_arquivo,
        });

        if (gazette) {
          gazettes.push(gazette);
        }
      }

      logger.info(`Found ${gazettes.length} gazettes for ${this.spiderConfig.name}`);
      return gazettes;
    } catch (error) {
      logger.error(`Error crawling ${this.spiderConfig.name}:`, { error });
      return gazettes;
    }
  }

  /**
   * Parse the publication date from the API response
   * Format: "DD/MM/YYYY" or "YYYY-MM-DD"
   */
  private parsePublicationDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    try {
      // Try DD/MM/YYYY format first
      const ddmmyyyyMatch = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (ddmmyyyyMatch) {
        const [, day, month, year] = ddmmyyyyMatch;
        return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
      }

      // Try ISO format
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return date;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Extract edition number from filename
   * e.g., "JAPERI - 6017 - 21 DE JANEIRO DE 2026.pdf" -> "6017"
   * e.g., "JAPERI - 6004 - EXTRA - 30 DE DEZEMBRO DE 2025.pdf" -> "6004"
   */
  private extractEditionNumber(text: string): string | undefined {
    if (!text) return undefined;
    
    // Pattern: CITY - NUMBER - DATE or CITY - NUMBER - EXTRA - DATE
    const match = text.match(/\s*-\s*(\d+)\s*-/);
    return match ? match[1] : undefined;
  }
}
