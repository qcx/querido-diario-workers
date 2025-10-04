/**
 * Entity Extractor - Extracts named entities and structured data
 */

import { BaseAnalyzer } from './base-analyzer';
import { OcrResult, Finding, EntityType, AnalyzerConfig } from '../types';

export class EntityExtractor extends BaseAnalyzer {
  private entityTypes: EntityType[];

  constructor(config: AnalyzerConfig & { entityTypes?: EntityType[] } = { enabled: true }) {
    super('entity-extractor', 'entity', config);
    
    this.entityTypes = config.entityTypes || [
      'person',
      'organization',
      'location',
      'date',
      'money',
      'cpf',
      'cnpj',
      'law_reference',
      'decree_reference',
    ];
  }

  protected async performAnalysis(ocrResult: OcrResult): Promise<Finding[]> {
    const findings: Finding[] = [];
    const text = ocrResult.extractedText || '';

    for (const entityType of this.entityTypes) {
      const entities = await this.extractEntities(text, entityType);
      findings.push(...entities);
    }

    return findings;
  }

  /**
   * Extract entities of a specific type
   */
  private async extractEntities(text: string, entityType: EntityType): Promise<Finding[]> {
    switch (entityType) {
      case 'cpf':
        return this.extractCPF(text);
      case 'cnpj':
        return this.extractCNPJ(text);
      case 'money':
        return this.extractMoney(text);
      case 'date':
        return this.extractDates(text);
      case 'law_reference':
        return this.extractLawReferences(text);
      case 'decree_reference':
        return this.extractDecreeReferences(text);
      case 'person':
        return this.extractPersons(text);
      case 'organization':
        return this.extractOrganizations(text);
      case 'location':
        return this.extractLocations(text);
      default:
        return [];
    }
  }

  /**
   * Extract CPF numbers
   */
  private extractCPF(text: string): Finding[] {
    const findings: Finding[] = [];
    const cpfRegex = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
    
    let match;
    while ((match = cpfRegex.exec(text)) !== null) {
      const cpf = match[0].replace(/[^\d]/g, '');
      
      if (this.isValidCPF(cpf)) {
        findings.push(
          this.createFinding(
            'entity:cpf',
            {
              cpf: this.formatCPF(cpf),
              raw: match[0],
              position: match.index,
            },
            0.95,
            this.extractContext(text, match.index)
          )
        );
      }
    }
    
    return findings;
  }

  /**
   * Extract CNPJ numbers
   */
  private extractCNPJ(text: string): Finding[] {
    const findings: Finding[] = [];
    const cnpjRegex = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
    
    let match;
    while ((match = cnpjRegex.exec(text)) !== null) {
      const cnpj = match[0].replace(/[^\d]/g, '');
      
      if (this.isValidCNPJ(cnpj)) {
        findings.push(
          this.createFinding(
            'entity:cnpj',
            {
              cnpj: this.formatCNPJ(cnpj),
              raw: match[0],
              position: match.index,
            },
            0.95,
            this.extractContext(text, match.index)
          )
        );
      }
    }
    
    return findings;
  }

  /**
   * Extract monetary values
   */
  private extractMoney(text: string): Finding[] {
    const findings: Finding[] = [];
    const moneyRegex = /R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/g;
    
    let match;
    while ((match = moneyRegex.exec(text)) !== null) {
      const valueStr = match[1].replace(/\./g, '').replace(',', '.');
      const value = parseFloat(valueStr);
      
      findings.push(
        this.createFinding(
          'entity:money',
          {
            value,
            formatted: match[0],
            currency: 'BRL',
            position: match.index,
          },
          0.9,
          this.extractContext(text, match.index)
        )
      );
    }
    
    return findings;
  }

  /**
   * Extract dates
   */
  private extractDates(text: string): Finding[] {
    const findings: Finding[] = [];
    
    // DD/MM/YYYY or DD-MM-YYYY
    const dateRegex = /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/g;
    
    let match;
    while ((match = dateRegex.exec(text)) !== null) {
      const day = parseInt(match[1]);
      const month = parseInt(match[2]);
      const year = parseInt(match[3]);
      
      if (this.isValidDate(day, month, year)) {
        findings.push(
          this.createFinding(
            'entity:date',
            {
              date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
              formatted: match[0],
              position: match.index,
            },
            0.85,
            this.extractContext(text, match.index)
          )
        );
      }
    }
    
    return findings;
  }

  /**
   * Extract law references
   */
  private extractLawReferences(text: string): Finding[] {
    const findings: Finding[] = [];
    const lawRegex = /Lei\s+(?:n[º°]?\s*)?(\d+(?:[\.\/]\d+)*)/gi;
    
    let match;
    while ((match = lawRegex.exec(text)) !== null) {
      findings.push(
        this.createFinding(
          'entity:law_reference',
          {
            lawNumber: match[1],
            fullText: match[0],
            position: match.index,
          },
          0.9,
          this.extractContext(text, match.index)
        )
      );
    }
    
    return findings;
  }

  /**
   * Extract decree references
   */
  private extractDecreeReferences(text: string): Finding[] {
    const findings: Finding[] = [];
    const decreeRegex = /Decreto\s+(?:n[º°]?\s*)?(\d+(?:[\.\/]\d+)*)/gi;
    
    let match;
    while ((match = decreeRegex.exec(text)) !== null) {
      findings.push(
        this.createFinding(
          'entity:decree_reference',
          {
            decreeNumber: match[1],
            fullText: match[0],
            position: match.index,
          },
          0.9,
          this.extractContext(text, match.index)
        )
      );
    }
    
    return findings;
  }

  /**
   * Extract person names (simplified)
   */
  private extractPersons(text: string): Finding[] {
    const findings: Finding[] = [];
    
    // Look for capitalized names (2-4 words)
    const nameRegex = /\b([A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜ][a-zàáâãäåçèéêëìíîïñòóôõöùúûü]+(?:\s+[A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜ][a-zàáâãäåçèéêëìíîïñòóôõöùúûü]+){1,3})\b/g;
    
    let match;
    while ((match = nameRegex.exec(text)) !== null) {
      const name = match[1];
      
      // Filter out common false positives
      if (!this.isCommonWord(name)) {
        findings.push(
          this.createFinding(
            'entity:person',
            {
              name,
              position: match.index,
            },
            0.6, // Lower confidence for name extraction
            this.extractContext(text, match.index)
          )
        );
      }
    }
    
    return findings;
  }

  /**
   * Extract organizations (simplified)
   */
  private extractOrganizations(text: string): Finding[] {
    const findings: Finding[] = [];
    
    // Common organization indicators
    const orgPatterns = [
      /\b(Prefeitura\s+Municipal\s+de\s+[A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜ][a-zàáâãäåçèéêëìíîïñòóôõöùúûü]+)/gi,
      /\b(Câmara\s+Municipal\s+de\s+[A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜ][a-zàáâãäåçèéêëìíîïñòóôõöùúûü]+)/gi,
      /\b(Secretaria\s+(?:Municipal\s+)?de\s+[A-ZÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜ][a-zàáâãäåçèéêëìíîïñòóôõöùúûü]+)/gi,
    ];
    
    for (const pattern of orgPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        findings.push(
          this.createFinding(
            'entity:organization',
            {
              name: match[1],
              position: match.index,
            },
            0.85,
            this.extractContext(text, match.index)
          )
        );
      }
    }
    
    return findings;
  }

  /**
   * Extract locations (simplified)
   */
  private extractLocations(text: string): Finding[] {
    const findings: Finding[] = [];
    
    // Brazilian state abbreviations
    const stateRegex = /\b([A-Z]{2})\b/g;
    const validStates = [
      'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
      'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
      'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
    ];
    
    let match;
    while ((match = stateRegex.exec(text)) !== null) {
      if (validStates.includes(match[1])) {
        findings.push(
          this.createFinding(
            'entity:location',
            {
              type: 'state',
              state: match[1],
              position: match.index,
            },
            0.8,
            this.extractContext(text, match.index)
          )
        );
      }
    }
    
    return findings;
  }

  // Validation helpers
  
  private isValidCPF(cpf: string): boolean {
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
    
    let sum = 0;
    for (let i = 0; i < 9; i++) {
      sum += parseInt(cpf[i]) * (10 - i);
    }
    let digit = 11 - (sum % 11);
    if (digit > 9) digit = 0;
    if (digit !== parseInt(cpf[9])) return false;
    
    sum = 0;
    for (let i = 0; i < 10; i++) {
      sum += parseInt(cpf[i]) * (11 - i);
    }
    digit = 11 - (sum % 11);
    if (digit > 9) digit = 0;
    return digit === parseInt(cpf[10]);
  }

  private isValidCNPJ(cnpj: string): boolean {
    if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
    
    const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    
    let sum = 0;
    for (let i = 0; i < 12; i++) {
      sum += parseInt(cnpj[i]) * weights1[i];
    }
    let digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (digit !== parseInt(cnpj[12])) return false;
    
    sum = 0;
    for (let i = 0; i < 13; i++) {
      sum += parseInt(cnpj[i]) * weights2[i];
    }
    digit = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    return digit === parseInt(cnpj[13]);
  }

  private isValidDate(day: number, month: number, year: number): boolean {
    if (month < 1 || month > 12) return false;
    if (day < 1 || day > 31) return false;
    if (year < 1900 || year > 2100) return false;
    
    const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)) {
      daysInMonth[1] = 29;
    }
    
    return day <= daysInMonth[month - 1];
  }

  private isCommonWord(word: string): boolean {
    const commonWords = [
      'Artigo', 'Anexo', 'Considerando', 'Decreto', 'Lei', 'Portaria',
      'Resolve', 'Considerando', 'Prefeitura', 'Municipal', 'Estado',
    ];
    return commonWords.includes(word);
  }

  // Formatting helpers
  
  private formatCPF(cpf: string): string {
    return `${cpf.substring(0, 3)}.${cpf.substring(3, 6)}.${cpf.substring(6, 9)}-${cpf.substring(9)}`;
  }

  private formatCNPJ(cnpj: string): string {
    return `${cnpj.substring(0, 2)}.${cnpj.substring(2, 5)}.${cnpj.substring(5, 8)}/${cnpj.substring(8, 12)}-${cnpj.substring(12)}`;
  }

  private extractContext(text: string, position: number, length: number = 80): string {
    const start = Math.max(0, position - length);
    const end = Math.min(text.length, position + length);
    return text.substring(start, end).trim();
  }
}
