import { BaseSpider } from "./base-spider";
import { Gazette } from "../../types/gazette";
import { SpiderConfig, IndapConfig } from "../../types/spider-config";
import { DateRange } from "../../types";
import { logger } from "../../utils/logger";
import { getCurrentTimestamp } from "../../utils/date-utils";

/**
 * Spider for INDAP platform (diario.indap.org.br)
 * Used by some municipalities in Bahia (e.g., Coração de Maria, Araci)
 *
 * The INDAP platform has a JSON API that returns publications directly.
 * API endpoint: GET /buscar/cidade/{cidade_id}?ano={year}
 *
 * Response format:
 * [{
 *   "mes": "Dezembro",
 *   "ano": "2025",
 *   "publicacoes": {
 *     "01/12/2025": [{
 *       "id": 66838,
 *       "resumo": "...",
 *       "num_edicao": "03392",
 *       "data_publicacao": "2025-12-01T03:00:00.000000Z",
 *       "publicacao_arquivos": [{
 *         "anexo": {
 *           "arquivo": "publicacao/66838/xxx.pdf"
 *         }
 *       }]
 *     }]
 *   }
 * }]
 */

interface IndapAnexo {
  id: number;
  nome: string;
  arquivo: string;
  mime_type: string;
}

interface IndapArquivo {
  id: number;
  publicacao_id: number;
  anexo_id: number;
  nome: string;
  url: string | null;
  full_url: string | null;
  anexo: IndapAnexo;
}

interface IndapPublicacao {
  id: number;
  resumo: string;
  num_edicao: string;
  num_certificado: string;
  data_publicacao: string;
  desc: string;
  categoria_nome: string;
  orgao_nome: string;
  publicacao_arquivos: IndapArquivo[];
}

interface IndapMesData {
  mes: string;
  ano: string;
  publicacoes: Record<string, IndapPublicacao[]>;
}

export class IndapSpider extends BaseSpider {
  private estadoId: number;
  private cidadeId: number;
  private cidade: string;
  private estado: string;
  private orgao: string;
  private baseUrl: string = "https://diario.indap.org.br";
  private indapConfig: IndapConfig;

  constructor(config: SpiderConfig, dateRange: DateRange) {
    super(config, dateRange);
    const platformConfig = config.config as IndapConfig;
    this.indapConfig = platformConfig;
    this.estadoId = platformConfig.estadoId;
    this.cidadeId = platformConfig.cidadeId;
    this.cidade = platformConfig.cidade;
    this.estado = platformConfig.estado;
    this.orgao = platformConfig.orgao;

    logger.info(`Initializing IndapSpider for ${this.cidade}/${this.estado}`);
  }

  /**
   * Set browser binding (no-op - this spider uses HTTP API directly)
   * Kept for compatibility with registry-manager
   */
  setBrowser(_browser: Fetcher): void {
    // No-op: INDAP spider now uses HTTP API directly, no browser needed
  }

  /**
   * Build the API URL for fetching publications
   */
  private buildApiUrl(year?: number): string {
    const params = new URLSearchParams();
    if (year) {
      params.set("ano", year.toString());
    }
    const queryString = params.toString();
    return `${this.baseUrl}/buscar/cidade/${this.cidadeId}${queryString ? `?${queryString}` : ""}`;
  }

  /**
   * Build the PDF URL using the /publicacoes/{num_certificado}/anexo/{arquivo_id} pattern
   */
  private buildPdfUrl(numCertificado: string, arquivoId: number): string {
    // URL pattern: /publicacoes/{num_certificado}/anexo/{arquivo_id}
    return `${this.baseUrl}/publicacoes/${numCertificado}/anexo/${arquivoId}`;
  }

  async crawl(): Promise<Gazette[]> {
    const gazettes: Gazette[] = [];

    // Determine which years we need to fetch
    const startYear = this.startDate.getFullYear();
    const endYear = this.endDate.getFullYear();

    logger.info(`Starting INDAP crawl for ${this.cidade}/${this.estado}`, {
      cidadeId: this.cidadeId,
      dateRange: {
        start: this.startDate.toISOString(),
        end: this.endDate.toISOString(),
      },
      years: `${startYear}-${endYear}`,
    });

    // Fetch data for each year in the range
    for (let year = startYear; year <= endYear; year++) {
      try {
        const yearGazettes = await this.fetchYearData(year);
        gazettes.push(...yearGazettes);
      } catch (error) {
        logger.error(
          `Error fetching INDAP data for year ${year}:`,
          error as Error,
        );
      }
    }

    logger.info(
      `Successfully crawled ${gazettes.length} gazettes from INDAP API for ${this.cidade}/${this.estado}`,
    );

    return gazettes;
  }

  /**
   * Fetch gazette data for a specific year
   */
  private async fetchYearData(year: number): Promise<Gazette[]> {
    const url = this.buildApiUrl(year);
    const gazettes: Gazette[] = [];

    logger.debug(`Fetching INDAP data for year ${year}`, { url });

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "application/json",
          "X-Requested-With": "XMLHttpRequest",
        },
      });

      if (!response.ok) {
        logger.error(`INDAP API returned status ${response.status} for ${url}`);
        return [];
      }

      const data: IndapMesData[] = await response.json();

      if (!Array.isArray(data)) {
        logger.warn(`INDAP API returned unexpected data format for ${url}`);
        return [];
      }

      logger.debug(`Received ${data.length} month(s) of data for year ${year}`);

      // Process each month's data
      for (const mesData of data) {
        const monthGazettes = this.processMonthData(mesData);
        gazettes.push(...monthGazettes);
      }
    } catch (error) {
      logger.error(
        `Failed to fetch INDAP data for year ${year}:`,
        error as Error,
      );
    }

    return gazettes;
  }

  /**
   * Process data for a single month
   */
  private processMonthData(mesData: IndapMesData): Gazette[] {
    const gazettes: Gazette[] = [];
    const processedEditions = new Set<string>();

    // mesData.publicacoes is an object where keys are dates (DD/MM/YYYY)
    // and values are arrays of publications for that date
    for (const [dateKey, publicacoes] of Object.entries(mesData.publicacoes)) {
      // Parse date from DD/MM/YYYY to YYYY-MM-DD
      const [day, month, year] = dateKey.split("/");
      const isoDate = `${year}-${month}-${day}`;
      const pubDate = new Date(isoDate);

      // Skip if outside date range
      if (!this.isInDateRange(isoDate)) {
        continue;
      }

      // Group publications by edition number to avoid duplicates
      // (each edition might have multiple individual publications/arquivos)
      const editionMap = new Map<string, IndapPublicacao[]>();

      for (const pub of publicacoes) {
        const editionNumber = pub.num_edicao;
        if (!editionMap.has(editionNumber)) {
          editionMap.set(editionNumber, []);
        }
        editionMap.get(editionNumber)!.push(pub);
      }

      // Process each edition
      for (const [editionNumber, pubs] of editionMap) {
        const editionKey = `${isoDate}-${editionNumber}`;
        if (processedEditions.has(editionKey)) {
          continue;
        }
        processedEditions.add(editionKey);

        // Collect all PDF URLs for this edition
        const pdfUrls: string[] = [];
        const descriptions: string[] = [];

        for (const pub of pubs) {
          if (pub.resumo) {
            descriptions.push(pub.resumo);
          }
          if (pub.desc) {
            descriptions.push(pub.desc.substring(0, 200));
          }

          // Extract PDF URLs from arquivos using num_certificado and arquivo id
          for (const arquivo of pub.publicacao_arquivos || []) {
            if (arquivo.id && pub.num_certificado) {
              pdfUrls.push(this.buildPdfUrl(pub.num_certificado, arquivo.id));
            }
          }
        }

        // Create gazette entries for each PDF (or one entry if no PDFs)
        if (pdfUrls.length > 0) {
          // For now, create one gazette per PDF file
          for (let i = 0; i < pdfUrls.length; i++) {
            const gazette: Gazette = {
              date: isoDate,
              fileUrl: pdfUrls[i],
              territoryId: this.spiderConfig.territoryId,
              scrapedAt: getCurrentTimestamp(),
              isExtraEdition: false,
              power: "executive",
              editionNumber: editionNumber,
              sourceText:
                descriptions[i] ||
                descriptions[0] ||
                `Diário Oficial ${isoDate} - Edição ${editionNumber}`,
            };

            gazettes.push(gazette);
            logger.debug(
              `Found gazette: ${isoDate} - Edition ${editionNumber} - File ${i + 1}/${pdfUrls.length}`,
            );
          }
        } else {
          // No PDF files found for this edition - log warning
          logger.warn(
            `No PDF files found for ${this.cidade}/${this.estado} - Edition ${editionNumber} (${isoDate})`,
          );
        }
      }
    }

    return gazettes;
  }
}
