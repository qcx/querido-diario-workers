import puppeteer from '@cloudflare/puppeteer';
import { BaseSpider } from './base-spider';
import { SpiderConfig, Gazette, DateRange, SerproDoeConfig } from '../../types';
import { logger } from '../../utils/logger';

const BASE_URL = 'https://cidadesdoe.serpro.gov.br/govbrcidades_doe';
const LIST_API_SUFFIX = '/screenservices/govbrcidades_doe/Cidadao/DOEConsultaCidadao/ScreenDataSetGetTBDadosPublicacaoByDapIdHashPrefeitura';
const DOWNLOAD_API_SUFFIX = '/screenservices/govbrcidades_doe/ActionBuscaArquivoPublicacao';

const MAX_GAZETTES_PER_CRAWL = 200;
const SPA_LOAD_WAIT_MS = 8000;
const INTER_REQUEST_DELAY_MS = 500;

/**
 * Spider for the SERPRO DOE (Documento Oficial Eletrônico) platform.
 *
 * Platform: cidadesdoe.serpro.gov.br (OutSystems SPA)
 * Used by municipalities that publish via the gov.br DOE platform.
 *
 * Strategy:
 * 1. Navigate to the DOE page (identified by a city-specific Hash)
 * 2. Capture OutSystems versionInfo from initial API requests
 * 3. Call the list API from within the browser context (session-authenticated)
 * 4. For each gazette, call the download API to obtain PDF info
 *
 * Requires browser rendering (Cloudflare Workers Browser Rendering).
 */
export class SerproDoeSpider extends BaseSpider {
  private serproDoeConfig: SerproDoeConfig;
  private browser: Fetcher | null = null;

  constructor(spiderConfig: SpiderConfig, dateRange: DateRange, browser?: Fetcher) {
    super(spiderConfig, dateRange);
    this.serproDoeConfig = spiderConfig.config as SerproDoeConfig;
    this.browser = browser || null;

    logger.info(`Initializing SerproDoeSpider for ${spiderConfig.name}`, {
      hasBrowser: !!this.browser,
      hash: this.serproDoeConfig.hash.substring(0, 10) + '...',
    });
  }

  setBrowser(browser: Fetcher): void {
    this.browser = browser;
  }

  async crawl(): Promise<Gazette[]> {
    if (!this.browser) {
      logger.error(`SerproDoeSpider requires browser binding for ${this.spiderConfig.name}`);
      return [];
    }

    const gazettes: Gazette[] = [];
    let browserInstance = null;
    let page: any = null;

    try {
      browserInstance = await puppeteer.launch(this.browser);
      page = await browserInstance.newPage();

      let moduleVersion = '';
      const apiVersions: Record<string, string> = {};

      page.on('request', (request: any) => {
        if (request.url().includes('/screenservices/') && request.method() === 'POST') {
          try {
            const body = JSON.parse(request.postData());
            if (body?.versionInfo) {
              const path = new URL(request.url()).pathname;
              apiVersions[path] = body.versionInfo.apiVersion;
              if (!moduleVersion) {
                moduleVersion = body.versionInfo.moduleVersion;
              }
            }
          } catch {}
        }
      });

      const hash = this.serproDoeConfig.hash;
      const url = `${BASE_URL}/DoeConsultaCidadao?&Hash=${hash}`;

      logger.info(`Navigating to SERPRO DOE: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 60000 });
      this.requestCount++;

      await new Promise(resolve => setTimeout(resolve, SPA_LOAD_WAIT_MS));

      if (!moduleVersion) {
        logger.warn('Could not capture moduleVersion, using fallback');
        moduleVersion = 'ZC_5Ed9ozA9kGWhjH5CQgQ';
      }

      const listApiPath = `/govbrcidades_doe${LIST_API_SUFFIX}`;
      const listApiVersion = apiVersions[listApiPath] || 'zRAHqBwfWZSZQDXDYGpfWg';
      const downloadApiVersion = apiVersions[`/govbrcidades_doe${DOWNLOAD_API_SUFFIX}`] || 'p6Pwyi8dX2Lf8E0FKxeCTw';

      logger.info(`Captured versions - module: ${moduleVersion}, listApi: ${listApiVersion}`);

      const startStr = this.formatDateISO(this.startDate);
      const endStr = this.formatDateISO(this.endDate);

      const entries = await this.fetchGazetteList(page, {
        hash,
        startDate: startStr,
        endDate: endStr,
        moduleVersion,
        apiVersion: listApiVersion,
      });

      logger.info(`Found ${entries.length} gazette entries from SERPRO DOE`);

      for (const entry of entries.slice(0, MAX_GAZETTES_PER_CRAWL)) {
        try {
          const date = this.parseDate(entry.date);
          if (!date || !this.isInDateRange(date)) continue;

          const pdfInfo = await this.fetchPdfInfo(page, {
            docId: entry.id,
            hash,
            moduleVersion,
            apiVersion: downloadApiVersion,
          });

          await new Promise(resolve => setTimeout(resolve, INTER_REQUEST_DELAY_MS));

          let fileUrl: string | null = null;

          if (pdfInfo.url) {
            fileUrl = pdfInfo.url;
          } else if (pdfInfo.content) {
            fileUrl = `data:application/pdf;base64,${pdfInfo.content}`;
          }

          if (!fileUrl) {
            logger.warn(`No PDF URL or content for gazette ${entry.id} (${entry.title})`);
            continue;
          }

          const gazette = await this.createGazette(date, fileUrl, {
            editionNumber: entry.editionNumber,
            isExtraEdition: false,
            power: 'executive',
            skipUrlResolution: true,
            requiresClientRendering: true,
          });

          if (gazette) {
            gazettes.push(gazette);
          }
        } catch (error) {
          logger.warn(`Error processing gazette ${entry.id}: ${error}`);
        }
      }

      logger.info(`Successfully crawled ${gazettes.length} gazettes from SERPRO DOE`);
    } catch (error) {
      logger.error('Error crawling SERPRO DOE:', error as Error);
    } finally {
      if (page) await page.close().catch(() => {});
      if (browserInstance) await browserInstance.close().catch(() => {});
    }

    return gazettes;
  }

  private async fetchGazetteList(
    page: any,
    params: {
      hash: string;
      startDate: string;
      endDate: string;
      moduleVersion: string;
      apiVersion: string;
    },
  ): Promise<Array<{ id: string; title: string; date: string; editionNumber?: string }>> {
    const result = await page.evaluate(
      async (p: { hash: string; startDate: string; endDate: string; moduleVersion: string; apiVersion: string; baseUrl: string; listApiSuffix: string; maxRecord: number }) => {
        const allItems: any[] = [];
        let startIndex = 0;
        let hasMore = true;
        let errorMsg = '';

        while (hasMore) {
          try {
            const response = await fetch(`${p.baseUrl}${p.listApiSuffix}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                versionInfo: {
                  moduleVersion: p.moduleVersion,
                  apiVersion: p.apiVersion,
                },
                viewName: 'Cidadao.DOEConsultaCidadao',
                screenData: {
                  variables: {
                    Filtro: {
                      IdHashPrefeitura: '',
                      TermoTitulo: '',
                      TermoResumo: '',
                      OrgaoId: '0',
                      DataInicio: p.startDate,
                      DataFim: p.endDate,
                      TipoDocumento: '0',
                    },
                    ExibirDownloadConfirmacao: false,
                    TableSort: '',
                    StrPaginacao: {
                      MaxRecord: p.maxRecord,
                      StartIndex: startIndex,
                      IndexPagAtual: 0,
                      NumPaginas: '0',
                      TotalCount: 0,
                      TextItens: '',
                      ListRegPagPaginacao: {
                        List: [],
                        EmptyListItem: { NumReg: 0, NumRegText: '' },
                      },
                      SelNumRegPorPagina: p.maxRecord,
                      SelPagPaginacao: 1,
                    },
                    DownloadArquivo: {
                      NomeArquivo: '',
                      TamanhoArquivo: '',
                      ConteudoArquivo: null,
                      IdDadosPublicacao: '0',
                    },
                    LimpaPesquisa: false,
                    Prefeitura: '',
                    DataSiteKey: '',
                    Secret: '',
                    DadosPublicacao_Id: '0',
                    EnableButtonPesquisar: false,
                    ShowSpinner: false,
                    Hash: p.hash,
                  },
                },
                inputParameters: {},
              }),
            });

            const data = await response.json();
            let list: any[] = [];

            if (data?.data) {
              const d = data.data;
              for (const key of Object.keys(d)) {
                if (d[key]?.List && Array.isArray(d[key].List)) {
                  list = d[key].List;
                  break;
                }
                if (Array.isArray(d[key])) {
                  list = d[key];
                  break;
                }
              }
            }

            if (list.length === 0) {
              hasMore = false;
            } else {
              allItems.push(...list);
              startIndex += p.maxRecord;
              if (list.length < p.maxRecord) {
                hasMore = false;
              }
            }

            if (startIndex > 5000) hasMore = false;
          } catch (e: any) {
            errorMsg = e.message || String(e);
            hasMore = false;
          }
        }

        return { items: allItems, error: errorMsg };
      },
      {
        ...params,
        baseUrl: BASE_URL,
        listApiSuffix: LIST_API_SUFFIX,
        maxRecord: 50,
      },
    );

    if (result.error) {
      logger.warn(`Error fetching gazette list: ${result.error}`);
    }

    return result.items
      .map((item: any) => {
        const record = item.TB_DadosPublicacao || item;
        const id = String(record.Id || record.IdDadosPublicacao || record.Identifier || '');
        const title = record.DesPublicacao || record.Titulo || record.Title || '';
        const date = record.DataPublicacao || record.Date || '';

        const editionMatch = title.match(/n[º°]\s*(\d+)/i);
        const editionNumber = editionMatch ? editionMatch[1] : undefined;

        return { id, title, date, editionNumber };
      })
      .filter((item: { id: string }) => item.id);
  }

  private async fetchPdfInfo(
    page: any,
    params: {
      docId: string;
      hash: string;
      moduleVersion: string;
      apiVersion: string;
    },
  ): Promise<{ url: string | null; content: string | null; filename: string | null }> {
    return page.evaluate(
      async (p: { docId: string; hash: string; moduleVersion: string; apiVersion: string; baseUrl: string; downloadApiSuffix: string }) => {
        try {
          const response = await fetch(`${p.baseUrl}${p.downloadApiSuffix}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              versionInfo: {
                moduleVersion: p.moduleVersion,
                apiVersion: p.apiVersion,
              },
              viewName: 'Cidadao.DOEConsultaCidadao',
              inputParameters: {
                TB_DadosPublicacaoIdentifier_Input: p.docId,
                HashPrefeitura_Input: p.hash,
              },
            }),
          });

          const data = await response.json();
          const result = data?.data || {};

          const url =
            result.UrlArquivo ||
            result.Url ||
            result.FileUrl ||
            result.DownloadUrl ||
            null;

          const content =
            result.ConteudoArquivo ||
            result.Content ||
            result.FileContent ||
            null;

          const filename =
            result.NomeArquivo ||
            result.FileName ||
            null;

          return { url, content: content ? String(content) : null, filename };
        } catch {
          return { url: null, content: null, filename: null };
        }
      },
      {
        ...params,
        baseUrl: BASE_URL,
        downloadApiSuffix: DOWNLOAD_API_SUFFIX,
      },
    );
  }

  private formatDateISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private parseDate(dateStr: string): Date | null {
    if (!dateStr) return null;

    const brMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (brMatch) {
      return new Date(parseInt(brMatch[3]), parseInt(brMatch[2]) - 1, parseInt(brMatch[1]));
    }

    const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (isoMatch) {
      return new Date(parseInt(isoMatch[1]), parseInt(isoMatch[2]) - 1, parseInt(isoMatch[3]));
    }

    return null;
  }
}
