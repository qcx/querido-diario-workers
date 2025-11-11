/**
 * Abertura Extractor Service
 * Extracts detailed edital de abertura information from keyword:concurso_abertura findings
 */

import { OcrResult, Finding, ConcursoData, ConcursoFinding } from '../../types';
import { logger } from '../../utils';

export interface AberturaExtractorConfig {
  apiKey: string;
  model?: string;
  endpoint?: string;
  timeout?: number;
  enabled?: boolean;
}

/**
 * Extraction patterns for edital de abertura
 */
const EXTRACTION_PATTERNS = {
  editalNumero: [
    /edital\s+n[°º]?\s*(\d+\/\d{4})/i,
    /edital\s+n[°º]?\s*(\d+[-\/]\d{4})/i,
    /processo\s+n[°º]?\s*(\d+\/\d{4})/i,
    /edital\s+n[°º]?\s*(\d+[._-]\d{4})/i,
    /edital\s+n[°º]?\s*(\d{4}[-\/]\d+)/i,
    /edital\s+de\s+\w+\s+n[°º]?\s*(\d+\/\d{4})/i,
  ],
  
  orgao: [
    /prefeitura\s+(?:municipal\s+)?de\s+([^\n\r]{3,200})/i,
    /c[âa]mara\s+municipal\s+de\s+([^\n\r]{3,200})/i,
    /governo\s+do\s+estado\s+(?:de|do)\s+([^\n\r]{3,200})/i,
    /(?:^|\n)\s*(?:a\s+)?prefeitura\s+(?:municipal\s+)?de\s+([\wÀ-ÿ\s]{3,50}?)(?=[,\n]|torna|comunica|através)/i,
  ],
  
  vagas: [
    /(\d+)\s+(?:\([\w\s]+\)\s+)?vagas?/i,
    /total\s+de\s+(\d+)\s+vagas?/i,
    /n[úu]mero\s+de\s+vagas?:?\s*(\d+)/i,
  ],
  
  cargo: [
    /cargo:?\s*([^\n\r]{3,100})/i,
    /fun[çc][ãa]o:?\s*([^\n\r]{3,100})/i,
    /emprego:?\s*([^\n\r]{3,100})/i,
  ],
  
  salario: [
    /remunera[çc][ãa]o:?\s*R\$\s*([\d.,]+)/i,
    /sal[áa]rio:?\s*R\$\s*([\d.,]+)/i,
    /vencimento:?\s*R\$\s*([\d.,]+)/i,
    /R\$\s*([\d.,]+)\s*(?:mensais?|por\s+m[êe]s)/i,
  ],
  
  inscricoes: [
    /inscri[çc][õo]es.*de\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+a(?:t[ée])?\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /per[íi]odo\s+de\s+inscri[çc][ãa]o:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s+a\s+(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ],
  
  prova: [
    /prova.*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /data\s+da\s+prova:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /realiza[çc][ãa]o.*(\d{1,2}\/\d{1,2}\/\d{4})/i,
    /prova\s+em[:\s]*(\d{1,2}\/\d{1,2}\/\d{4})/i,
  ],
  
  taxa: [
    /taxa\s+de\s+inscri[çc][ãa]o:?\s*R\$\s*([\d.,]+)/i,
    /valor\s+da\s+inscri[çc][ãa]o:?\s*R\$\s*([\d.,]+)/i,
  ],
  
  banca: [
    /organiza(?:do)?(?:ra)?:?\s*([^\n\r.]{3,150})/i,
    /empresa\s+(?:organizadora|respons[áa]vel):?\s*([^\n\r.]{3,150})/i,
    /cnpj:?\s*(\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})/i,
  ],
  
  cidades: [
    /munic[íi]pios?:?\s*([^\n\r]{3,200})/i,
    /cidades?:?\s*([^\n\r]{3,200})/i,
    /localidades?:?\s*([^\n\r]{3,200})/i,
  ],
  
  // Table-specific patterns for markdown tables
  vagasTableRow: [
    /\|\s*([^|\n]{1,200}?)\s*\|\s*(CR|\d+)\s*\|/gi, // matches "| Professor I | CR |" or "| Professor | 10 |"
  ],
  
  datasTableRow: [
    /\|\s*([^|\n]{1,200}?)\s*\|\s*(\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4}(?:\s+a(?:t[ée])?\s+\d{1,2}\s*\/\s*\d{1,2}\s*\/\s*\d{4})?)\s*\|/gi,
  ],
};

/**
 * Service for extracting detailed information from edital de abertura
 */
export class AberturaExtractorService {
  private apiKey: string;
  private model: string;
  private endpoint: string;
  private timeout: number;
  private enabled: boolean;

  constructor(config: AberturaExtractorConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model || 'gpt-4o-mini';
    this.endpoint = config.endpoint || 'https://api.openai.com/v1/chat/completions';
    this.timeout = config.timeout || 30000;
    this.enabled = config.enabled ?? true;
  }

  /**
   * Process abertura findings and extract detailed information
   */
  async processAberturaFindings(
    ocrResult: OcrResult,
    aberturaFindings: Finding[]
  ): Promise<ConcursoFinding | null> {
    if (!this.enabled || aberturaFindings.length === 0) {
      return null;
    }

    console.log('aberturaFindings', aberturaFindings);

    const startTime = Date.now();
    const TOTAL_TIMEOUT = 500000; // 500 seconds
    let timeoutId: NodeJS.Timeout | null = null;
    let currentStage = 'initialization';
    let contextSize = 0;

    try {
      // Set up total timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          const elapsedTime = Date.now() - startTime;
          reject(new Error(
            `Abertura extraction exceeded total timeout (${TOTAL_TIMEOUT}ms). ` +
            `Stage: ${currentStage}, Elapsed: ${elapsedTime}ms, Context size: ${contextSize} chars`
          ));
        }, TOTAL_TIMEOUT);
      });

      // Main extraction logic
      const extractionPromise = (async () => {
        // Checkpoint: Start
        logger.info('Starting abertura extraction', {
          jobId: ocrResult.jobId,
          findingsCount: aberturaFindings.length,
          hasApiKey: !!this.apiKey,
          apiTimeout: this.timeout,
          totalTimeout: TOTAL_TIMEOUT,
        });

        // Stage: Context extraction
        currentStage = 'context-extraction';
        const context = this.extractSmartContext(ocrResult.extractedText || '', aberturaFindings);
        contextSize = context.length;

        // Checkpoint: Context extracted
        logger.info('Context extracted', {
          jobId: ocrResult.jobId,
          contextSize,
          elapsedMs: Date.now() - startTime,
        });

        if (context.length < 100) {
          console.log('context too short', context);
          logger.warn('Context too short for abertura extraction', {
            jobId: ocrResult.jobId,
            contextLength: context.length,
          });
          return null;
        }

        // Stage: Pattern extraction
        currentStage = 'pattern-extraction';
        const patternData = this.extractWithPatterns(context);

        logger.info('Pattern extraction completed', {
          jobId: ocrResult.jobId,
          hasOrgao: !!patternData.orgao,
          hasEditalNumero: !!patternData.editalNumero,
          hasVagas: !!patternData.vagas,
          elapsedMs: Date.now() - startTime,
        });

        // Stage: AI extraction
        let finalData = patternData;
        let extractionMethod: 'pattern' | 'ai' | 'hybrid' = 'pattern';

        if (this.apiKey) {
          try {
            currentStage = 'ai-extraction';
            
            // Checkpoint: Before AI call
            logger.info('Starting AI extraction', {
              jobId: ocrResult.jobId,
              contextSize,
              elapsedMs: Date.now() - startTime,
            });

            const aiData = await this.extractWithAI(context, patternData);
            
            // Checkpoint: After AI call
            logger.info('AI extraction completed', {
              jobId: ocrResult.jobId,
              success: !!aiData,
              elapsedMs: Date.now() - startTime,
            });

            if (aiData) {
              currentStage = 'data-merging';
              finalData = this.mergeExtractedData(patternData, aiData);
              extractionMethod = 'hybrid';
            }
          } catch (error) {
            console.log('ai extraction failed', error);
            logger.error('AI extraction failed, using pattern-based data only', error as Error, {
              jobId: ocrResult.jobId,
              stage: currentStage,
              elapsedMs: Date.now() - startTime,
            });
          }
        }

        // Stage: Creating finding
        currentStage = 'creating-finding';
        const concursoFinding = this.createConcursoFinding(
          finalData,
          extractionMethod,
          context,
          Math.max(...aberturaFindings.map(f => f.confidence))
        );

        const processingTime = Date.now() - startTime;

        // Checkpoint: Completion
        logger.info('Abertura extraction completed successfully', {
          jobId: ocrResult.jobId,
          extractionMethod,
          processingTimeMs: processingTime,
          hasOrgao: !!finalData.orgao,
          hasEditalNumero: !!finalData.editalNumero,
          hasVagas: !!finalData.vagas?.total,
          contextSize,
        });

        console.log('abertura extraction completed', concursoFinding);

        return concursoFinding;
      })();

      // Race between timeout and extraction
      const result = await Promise.race([extractionPromise, timeoutPromise]);
      
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      return result;
    } catch (error: any) {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      const elapsedTime = Date.now() - startTime;
      console.log('abertura extraction failed', error);
      
      logger.error('Abertura extraction failed', error, {
        jobId: ocrResult.jobId,
        stage: currentStage,
        elapsedMs: elapsedTime,
        contextSize,
        errorMessage: error.message,
      });
      
      return null;
    }
  }

  /**
   * Extract data using regex patterns and table extraction
   */
  private extractWithPatterns(text: string): Partial<ConcursoData> {
    const data: Partial<ConcursoData> = {};

    // Step 1: Extract from tables (high priority)
    const tables = this.detectMarkdownTables(text);
    for (const table of tables) {
      // Try to extract vagas from this table
      const vagasData = this.extractVagasFromTable(table.content);
      if (vagasData.vagas) {
        data.vagas = {
          ...data.vagas,
          ...vagasData.vagas,
        };
      }

      // Try to extract dates from this table
      const datasFromTable = this.extractDatasFromTable(table.content);
      if (Object.keys(datasFromTable).length > 0) {
        data.datas = {
          ...data.datas,
          ...datasFromTable,
        };
      }
    }

    // Step 2: Extract using regex patterns (fallback for fields not found in tables)

    // Extract edital number
    if (!data.editalNumero) {
      for (const pattern of EXTRACTION_PATTERNS.editalNumero) {
        const match = text.match(pattern);
        if (match) {
          data.editalNumero = match[1];
          break;
        }
      }
    }

    // Extract organization
    if (!data.orgao) {
      for (const pattern of EXTRACTION_PATTERNS.orgao) {
        const match = text.match(pattern);
        if (match) {
          data.orgao = match[1].trim();
          break;
        }
      }
    }

    // Extract total vacancies (if not from table)
    if (!data.vagas?.total) {
      const vagasMatch = text.match(EXTRACTION_PATTERNS.vagas[0]);
      if (vagasMatch) {
        data.vagas = {
          ...data.vagas,
          total: parseInt(vagasMatch[1], 10),
        };
      }
    }

    // Extract dates (if not from table)
    const datas: any = { ...data.datas };

    if (!datas.inscricoesInicio) {
      const inscricoesMatch = text.match(EXTRACTION_PATTERNS.inscricoes[0]);
      if (inscricoesMatch) {
        datas.inscricoesInicio = inscricoesMatch[1];
        datas.inscricoesFim = inscricoesMatch[2];
      }
    }

    if (!datas.prova && !datas.provaObjetiva) {
      const provaMatch = text.match(EXTRACTION_PATTERNS.prova[0]);
      if (provaMatch) {
        datas.prova = provaMatch[1];
      }
    }

    if (Object.keys(datas).length > 0) {
      data.datas = datas;
    }

    // Extract registration fee
    if (!data.taxas) {
      const taxaMatch = text.match(EXTRACTION_PATTERNS.taxa[0]);
      if (taxaMatch) {
        data.taxas = [{
          valor: this.parseMoneyValue(taxaMatch[1]),
        }];
      }
    }

    // Extract banca
    for (const pattern of EXTRACTION_PATTERNS.banca) {
      const match = text.match(pattern);
      if (match) {
        if (pattern.source.includes('cnpj')) {
          data.banca = { ...data.banca, cnpj: match[1] };
        } else {
          data.banca = { ...data.banca, nome: match[1].trim() };
        }
      }
    }

    // Extract cities
    if (!data.cidades) {
      for (const pattern of EXTRACTION_PATTERNS.cidades) {
        const match = text.match(pattern);
        if (match) {
          const cidadesText = match[1];
          const cidades = cidadesText.split(/[,;]/).map(c => c.trim()).filter(c => c.length > 0);
          data.cidades = cidades.map(nome => ({ nome }));
          break;
        }
      }
    }

    return data;
  }

  /**
   * Extract data using AI (OpenAI)
   */
  private async extractWithAI(
    context: string,
    patternData: Partial<ConcursoData>
  ): Promise<Partial<ConcursoData> | null> {
    if (!this.apiKey) {
      return null;
    }

    try {
      const prompt = this.buildExtractionPrompt(context, patternData);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            {
              role: 'system',
              content: 'You are a specialized assistant for extracting structured data from Brazilian public contest (concurso público) opening notices (edital de abertura). Always respond with valid JSON.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          temperature: 0.1,
          max_tokens: 2000,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
      }

      const result = await response.json() as any;
      const content = result.choices?.[0]?.message?.content;

      if (!content) {
        return null;
      }

      const parsed = JSON.parse(content);
      return parsed;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new Error(`OpenAI API timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Build extraction prompt for AI
   */
  private buildExtractionPrompt(context: string, patternData: Partial<ConcursoData>): string {
    return `Extract detailed information from this PUBLIC CONTEST OPENING NOTICE (Edital de Abertura):

${context}

Pattern-based data already extracted (enhance/correct if needed):
${JSON.stringify(patternData, null, 2)}

IMPORTANT NOTES:
- The document may contain markdown tables with the format:
  | Column 1 | Column 2 |
  | --- | --- |
  | Value    | Value    |
- "CR" means "Cadastro Reserva" (reserve registration) - extract as string "CR", not as a number
- Look for chronogram/calendar tables that list events and dates
- Extract ALL positions (cargos) from vacancy tables with their respective data

Extract and return JSON with ALL available fields:
{
  "orgao": "organization name",
  "editalNumero": "edital number",
  "vagas": {
    "total": number | "CR",
    "porCargo": [{"cargo": "position name", "vagas": number | "CR", "salario": number, "requisitos": "requirements"}],
    "reservaPCD": number
  },
  "datas": {
    "inscricoesInicio": "DD/MM/YYYY",
    "inscricoesFim": "DD/MM/YYYY",
    "prova": "DD/MM/YYYY",
    "provaObjetiva": "DD/MM/YYYY",
    "resultado": "DD/MM/YYYY"
  },
  "taxas": [{"cargo": "position", "valor": number}],
  "banca": {"nome": "organization", "cnpj": "XX.XXX.XXX/XXXX-XX"},
  "cidades": [{"nome": "city name", "vagas": number | "CR"}]
}

If a field is not found, omit it from the response. Focus on accuracy and completeness.`;
  }

  /**
   * Merge pattern-based and AI-extracted data
   */
  private mergeExtractedData(
    patternData: Partial<ConcursoData>,
    aiData: Partial<ConcursoData>
  ): Partial<ConcursoData> {
    // AI data takes precedence, but keep pattern data as fallback
    return {
      ...patternData,
      ...aiData,
      // Merge nested objects carefully
      vagas: aiData.vagas || patternData.vagas,
      datas: { ...patternData.datas, ...aiData.datas },
      banca: { ...patternData.banca, ...aiData.banca },
      cidades: aiData.cidades || patternData.cidades,
      observacoes: [
        ...(patternData.observacoes || []),
        ...(aiData.observacoes || []),
      ],
    };
  }

  /**
   * Create a ConcursoFinding with the extracted data
   */
  private createConcursoFinding(
    extractedData: Partial<ConcursoData>,
    extractionMethod: 'pattern' | 'ai' | 'hybrid',
    context: string,
    confidence: number
  ): ConcursoFinding {
    const concursoData: ConcursoData = {
      documentType: 'edital_abertura',
      documentTypeConfidence: confidence,
      ...extractedData,
    };

    return {
      type: 'concurso',
      confidence,
      context: context.substring(0, 500), // First 500 chars for context
      data: {
        category: 'concurso_publico',
        concursoData,
        extractionMethod,
        documentType: 'edital_abertura',
      },
    };
  }

  /**
   * Parse money value from string
   */
  private parseMoneyValue(value: string): number {
    // Remove dots (thousand separators) and replace comma with dot (decimal)
    const normalized = value.replace(/\./g, '').replace(',', '.');
    return parseFloat(normalized);
  }

  /**
   * Detect markdown tables in text
   */
  private detectMarkdownTables(text: string): Array<{start: number, end: number, content: string}> {
    const tables: Array<{start: number, end: number, content: string}> = [];
    const lines = text.split('\n');
    let inTable = false;
    let tableStart = 0;
    let tableLines: string[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const isPipeLine = /\|.*\|/.test(line);

      if (isPipeLine && !inTable) {
        // Start of potential table
        inTable = true;
        tableStart = text.indexOf(line);
        tableLines = [line];
      } else if (isPipeLine && inTable) {
        // Continue table
        tableLines.push(line);
      } else if (inTable && !isPipeLine) {
        // End of table
        inTable = false;
        if (tableLines.length >= 2) { // At least header + separator or header + data
          const tableContent = tableLines.join('\n');
          tables.push({
            start: tableStart,
            end: tableStart + tableContent.length,
            content: tableContent,
          });
        }
        tableLines = [];
      }
    }

    // Handle table at end of text
    if (inTable && tableLines.length >= 2) {
      const tableContent = tableLines.join('\n');
      tables.push({
        start: tableStart,
        end: tableStart + tableContent.length,
        content: tableContent,
      });
    }

    return tables;
  }

  /**
   * Parse a table row into cells
   */
  private parseTableRow(row: string): string[] {
    return row
      .split('|')
      .map(cell => cell.trim())
      .filter(cell => cell.length > 0);
  }

  /**
   * Extract vagas data from a table
   */
  private extractVagasFromTable(tableContent: string): Partial<ConcursoData> {
    const lines = tableContent.split('\n').filter(l => l.trim());
    if (lines.length < 2) return {};

    const data: Partial<ConcursoData> = {};
    const headerRow = this.parseTableRow(lines[0]);
    
    // Find column indices
    const cargoIdx = headerRow.findIndex(h => /fun[çc][õo]es?|cargos?/i.test(h));
    const vagasIdx = headerRow.findIndex(h => /vagas?|total/i.test(h));
    const salarioIdx = headerRow.findIndex(h => /vencimentos?|sal[áa]rio|remunera[çc][ãa]o/i.test(h));
    const requisitosIdx = headerRow.findIndex(h => /requisitos?/i.test(h));

    if (cargoIdx === -1) return data;

    const cargos: Array<{cargo: string, vagas: number | string, requisitos?: string, salario?: number}> = [];

    // Skip header and separator lines
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (/^\|?\s*[-:]+\s*\|/.test(line)) continue; // Skip separator

      const cells = this.parseTableRow(line);
      if (cells.length <= cargoIdx) continue;

      const cargo = cells[cargoIdx];
      if (!cargo || cargo === 'Total' || cargo === 'AC' || cargo === 'PcD') continue;

      const cargoData: any = { cargo };

      // Extract vagas (can be number or "CR")
      if (vagasIdx >= 0 && cells[vagasIdx]) {
        const vagasValue = cells[vagasIdx].trim();
        if (vagasValue === 'CR') {
          cargoData.vagas = 'CR';
        } else if (/^\d+$/.test(vagasValue)) {
          cargoData.vagas = parseInt(vagasValue, 10);
        }
      }

      // Extract salario
      if (salarioIdx >= 0 && cells[salarioIdx]) {
        const salarioMatch = cells[salarioIdx].match(/R\$?\s*([\d.,]+)/);
        if (salarioMatch) {
          cargoData.salario = this.parseMoneyValue(salarioMatch[1]);
        }
      }

      // Extract requisitos
      if (requisitosIdx >= 0 && cells[requisitosIdx]) {
        cargoData.requisitos = cells[requisitosIdx];
      }

      if (Object.keys(cargoData).length > 1) {
        cargos.push(cargoData);
      }
    }

    if (cargos.length > 0) {
      data.vagas = { porCargo: cargos };
    }

    return data;
  }

  /**
   * Extract dates from a chronogram table
   */
  private extractDatasFromTable(tableContent: string): Record<string, string> {
    const datas: Record<string, string> = {};
    const lines = tableContent.split('\n').filter(l => l.trim());

    for (const line of lines) {
      if (/^\|?\s*[-:]+\s*\|/.test(line)) continue; // Skip separator
      
      const cells = this.parseTableRow(line);
      if (cells.length < 2) continue;

      const event = cells[0];
      const date = cells[1];

      // Map events to field names
      if (/inscri[çc][õo]es/i.test(event)) {
        const dateMatch = date.match(/(\d{1,2}\/\d{1,2}\/\d{4})\s+a(?:t[ée])?\s+(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dateMatch) {
          datas.inscricoesInicio = dateMatch[1];
          datas.inscricoesFim = dateMatch[2];
        } else {
          const singleDate = date.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
          if (singleDate && !datas.inscricoesInicio) {
            datas.inscricoesInicio = singleDate[1];
          }
        }
      } else if (/prova.*objetiva/i.test(event) || /aplica[çc][ãa]o.*prova/i.test(event)) {
        const dateMatch = date.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dateMatch) {
          datas.provaObjetiva = dateMatch[1];
          if (!datas.prova) datas.prova = dateMatch[1];
        }
      } else if (/resultado.*final/i.test(event)) {
        const dateMatch = date.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dateMatch) {
          datas.resultado = dateMatch[1];
        }
      } else if (/gabarito.*preliminar/i.test(event) || /divulga[çc][ãa]o.*gabarito/i.test(event)) {
        const dateMatch = date.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dateMatch && !datas.prova) {
          // If we don't have a prova date yet, gabarito date might be close
        }
      } else if (/homologa[çc][ãa]o/i.test(event)) {
        const dateMatch = date.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (dateMatch && dateMatch[1] !== 'A Definir') {
          datas.homologacao = dateMatch[1];
        }
      }
    }

    return datas;
  }

  /**
   * Smart context extraction that identifies and combines key sections
   */
  private extractSmartContext(text: string, findings: Finding[]): string {
    const maxTotalLength = 20000; // Respect API limits
    const sections: Array<{content: string, priority: number, label: string}> = [];

    // 1. Extract context around findings (high priority)
    if (findings.length > 0) {
      const positions = findings
        .map(f => f.data.position || 0)
        .filter(p => p > 0);

      if (positions.length > 0) {
        const earliestPosition = Math.min(...positions);
        const contextStart = Math.max(0, earliestPosition - 2000);
        const contextEnd = Math.min(text.length, earliestPosition + 6000);
        sections.push({
          content: text.substring(contextStart, contextEnd),
          priority: 10,
          label: 'finding-context',
        });
      }
    }

    // 2. Search for key sections
    const keyPatterns = [
      { pattern: /quadro\s+de\s+vagas|tabela\s+de\s+vagas|fun[çc][õo]es.*vagas/i, label: 'vagas-section', priority: 9, contextSize: 3000 },
      { pattern: /cronograma|calend[áa]rio|datas?\s+importantes?|evento.*data/i, label: 'dates-section', priority: 9, contextSize: 3000 },
      { pattern: /edital\s+(?:de\s+)?abertura|processo\s+seletivo.*n[°º]?/i, label: 'header', priority: 8, contextSize: 2000 },
    ];

    for (const {pattern, label, priority, contextSize} of keyPatterns) {
      const match = text.match(pattern);
      if (match && match.index !== undefined) {
        const start = Math.max(0, match.index - 500);
        const end = Math.min(text.length, match.index + contextSize);
        sections.push({
          content: text.substring(start, end),
          priority,
          label,
        });
      }
    }

    // 3. Extract all markdown tables (high priority)
    const tables = this.detectMarkdownTables(text);
    for (const table of tables) {
      sections.push({
        content: table.content,
        priority: 9,
        label: 'table',
      });
    }

    // 4. Sort by priority and combine, avoiding excessive duplication
    sections.sort((a, b) => b.priority - a.priority);
    
    let combined = '';

    for (const section of sections) {
      if (combined.length + section.content.length > maxTotalLength) {
        break;
      }

      // Simple deduplication: check if content is already substantially included
      const sampleText = section.content.substring(0, 200);
      if (!combined.includes(sampleText)) {
        combined += '\n\n---\n\n' + section.content;
      }
    }

    // If we still have empty context, take from beginning
    if (combined.length < 1000) {
      combined = text.substring(0, Math.min(text.length, maxTotalLength));
    }

    return combined;
  }

  /**
   * Check if extractor is enabled
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
