/**
 * Concurso Data Enricher Service
 * Validates, normalizes, and enriches concurso data for accuracy
 */

import { logger } from '../utils';
import { parseBrazilianDate, toISODate } from '../utils/date-utils';
import { isValid, isFuture, isPast, differenceInDays, parseISO } from 'date-fns';

export interface ValidationResult {
  valid: boolean;
  normalized?: any;
  warnings: string[];
  errors: string[];
}

export interface EnrichedDate {
  original: string;
  normalized: string; // ISO format YYYY-MM-DD
  valid: boolean;
  daysFromNow?: number;
  isPast?: boolean;
  isFuture?: boolean;
}

export interface EnrichedMoney {
  original: string | number;
  normalized: number;
  formatted: string; // R$ X.XXX,XX
  valid: boolean;
  currency: string;
  warnings: string[];
  errors: string[];
}

export interface EnrichedCNPJ {
  original: string;
  normalized: string; // XX.XXX.XXX/XXXX-XX
  valid: boolean;
  digitsOnly: string;
}

export interface EnrichedText {
  original: string;
  normalized: string;
  changes: string[];
}

/**
 * Date validation and normalization
 */
export class DateValidator {
  /**
   * Normalize and validate a date string
   */
  static normalize(dateStr: string | undefined | null): EnrichedDate | null {
    if (!dateStr) return null;

    const result: EnrichedDate = {
      original: dateStr,
      normalized: '',
      valid: false,
    };

    try {
      // Try to parse Brazilian date format
      let date = parseBrazilianDate(dateStr);
      if (!isValid(date)) {
        const isoCandidate = parseISO(dateStr);
        if (isValid(isoCandidate)) {
          date = isoCandidate;
        }
      }
      if (!isValid(date)) {
        return result;
      }

      result.normalized = toISODate(date);
      result.valid = true;
      result.isPast = isPast(date);
      result.isFuture = isFuture(date);
      result.daysFromNow = differenceInDays(date, new Date());

      return result;
    } catch (error) {
      logger.debug('Failed to parse date', { dateStr, error });
      return result;
    }
  }

  /**
   * Validate date range (start should be before end)
   */
  static validateRange(startDate: string, endDate: string): ValidationResult {
    const result: ValidationResult = {
      valid: true,
      warnings: [],
      errors: [],
    };

    const start = this.normalize(startDate);
    const end = this.normalize(endDate);

    if (!start?.valid) {
      result.valid = false;
      result.errors.push(`Invalid start date: ${startDate}`);
    }

    if (!end?.valid) {
      result.valid = false;
      result.errors.push(`Invalid end date: ${endDate}`);
    }

    if (start?.valid && end?.valid) {
      if (start.normalized > end.normalized) {
        result.valid = false;
        result.errors.push('Start date is after end date');
      }
    }

    return result;
  }

  /**
   * Detect common date inversions (day/month swap)
   */
  static detectInversion(dateStr: string): boolean {
    // Check if date looks like MM/DD/YYYY instead of DD/MM/YYYY
    const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return false;

    const first = parseInt(match[1], 10);
    const second = parseInt(match[2], 10);

    // If first number > 12, it's definitely DD/MM/YYYY (correct)
    if (first > 12) return false;

    // If second number > 12, it might be inverted
    if (second > 12) return true;

    // Both <= 12, can't determine with certainty
    return false;
  }
}

/**
 * Money value validation and normalization
 */
export class MoneyValidator {
  private static readonly MIN_SALARY = 1412.00; // Current minimum wage BR (2024)
  private static readonly MAX_SALARY = 1000000.00; // Reasonable max for public sector
  
  /**
   * Normalize money value from various formats
   */
  static normalize(value: string | number | undefined | null): EnrichedMoney | null {
    if (value === undefined || value === null) return null;

    const result: EnrichedMoney = {
      original: value,
      normalized: 0,
      formatted: '',
      valid: false,
      currency: 'BRL',
      warnings: [],
      errors: [],
    };

    try {
      let numValue: number;

      if (typeof value === 'number') {
        numValue = value;
      } else {
        // Remove currency symbols and normalize
        const cleaned = value
          .replace(/[R$\s]/g, '')
          .trim();
        
        const sanitized = cleaned.replace(/[^\d.,-]/g, '');
        const lastComma = sanitized.lastIndexOf(',');
        const lastDot = sanitized.lastIndexOf('.');

        if (lastComma !== -1 && lastComma > lastDot) {
          // Comma as decimal separator (Brazilian format)
          numValue = parseFloat(sanitized.replace(/\./g, '').replace(',', '.'));
        } else if (lastDot !== -1) {
          const decimals = sanitized.length - lastDot - 1;
          if (decimals <= 2) {
            // Dot as decimal separator
            numValue = parseFloat(sanitized.replace(/,/g, ''));
          } else {
            // Dot used for grouping; strip all separators
            numValue = parseFloat(sanitized.replace(/[.,]/g, ''));
          }
        } else {
          // No decimal marker, just digits (possibly with grouping)
          numValue = parseFloat(sanitized.replace(/[.,]/g, ''));
        }
      }

      if (isNaN(numValue)) {
        result.errors = ['Cannot parse money value'];
        return result;
      }

      result.normalized = numValue;
      result.valid = true;

      // Format as Brazilian currency
      result.formatted = new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
      }).format(numValue);

      // Validate plausibility
      if (numValue < this.MIN_SALARY) {
        result.warnings.push(`Value below minimum wage (R$ ${this.MIN_SALARY.toFixed(2)})`);
      }

      if (numValue > this.MAX_SALARY) {
        result.warnings.push(`Unusually high value for public sector`);
      }

      // Detect common OCR errors
      if (numValue < 100) {
        result.warnings.push('Value suspiciously low - possible OCR error');
      }

      return result;
    } catch (error) {
      logger.debug('Failed to normalize money value', { value, error });
      result.errors = [(error as Error).message];
      return result;
    }
  }

  /**
   * Detect if value might be missing decimal separator
   */
  static detectMissingDecimal(value: number): boolean {
    // If value is suspiciously round and large, might be missing decimal
    // e.g., 350000 should be 3500.00
    return value > 10000 && value % 100 === 0;
  }
}

/**
 * CNPJ validation and normalization
 */
export class CNPJValidator {
  /**
   * Normalize CNPJ to standard format
   */
  static normalize(cnpj: string | undefined | null): EnrichedCNPJ | null {
    if (!cnpj) return null;

    const result: EnrichedCNPJ = {
      original: cnpj,
      normalized: '',
      valid: false,
      digitsOnly: '',
    };

    try {
      // Remove all non-digit characters
      const digits = cnpj.replace(/\D/g, '');
      result.digitsOnly = digits;

      // CNPJ must have exactly 14 digits
      if (digits.length !== 14) {
        return result;
      }

      // Format: XX.XXX.XXX/XXXX-XX
      result.normalized = digits.replace(
        /^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/,
        '$1.$2.$3/$4-$5'
      );

      // Validate check digits
      result.valid = this.validateCheckDigits(digits);

      return result;
    } catch (error) {
      logger.debug('Failed to normalize CNPJ', { cnpj, error });
      return result;
    }
  }

  /**
   * Validate CNPJ check digits
   */
  private static validateCheckDigits(cnpj: string): boolean {
    if (cnpj.length !== 14) return false;

    // Check for known invalid patterns (all same digit)
    if (/^(\d)\1{13}$/.test(cnpj)) return false;

    // Calculate first check digit
    let size = cnpj.length - 2;
    let numbers = cnpj.substring(0, size);
    const digits = cnpj.substring(size);
    let sum = 0;
    let pos = size - 7;

    for (let i = size; i >= 1; i--) {
      sum += parseInt(numbers.charAt(size - i)) * pos--;
      if (pos < 2) pos = 9;
    }

    let result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (result !== parseInt(digits.charAt(0))) return false;

    // Calculate second check digit
    size = size + 1;
    numbers = cnpj.substring(0, size);
    sum = 0;
    pos = size - 7;

    for (let i = size; i >= 1; i--) {
      sum += parseInt(numbers.charAt(size - i)) * pos--;
      if (pos < 2) pos = 9;
    }

    result = sum % 11 < 2 ? 0 : 11 - (sum % 11);
    if (result !== parseInt(digits.charAt(1))) return false;

    return true;
  }
}

/**
 * Text cleaning and normalization
 */
export class TextNormalizer {
  /**
   * Clean and normalize text
   */
  static normalize(text: string | undefined | null): EnrichedText | null {
    if (!text) return null;

    const changes: string[] = [];
    let normalized = text;

    // Remove excessive whitespace
    const beforeWhitespace = normalized;
    normalized = normalized.replace(/\s+/g, ' ').trim();
    if (beforeWhitespace !== normalized) {
      changes.push('removed_excessive_whitespace');
    }

    // Remove common OCR artifacts
    const beforeOCR = normalized;
    normalized = normalized
      .replace(/[��]/g, '') // Remove placeholder characters
      .replace(/\u0000/g, '') // Remove null characters
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Remove control characters
    if (beforeOCR !== normalized) {
      changes.push('removed_ocr_artifacts');
    }

    // Fix common encoding issues
    const beforeEncoding = normalized;
    normalized = normalized
      .replace(/Ã§/g, 'ç')
      .replace(/Ã£/g, 'ã')
      .replace(/Ã¡/g, 'á')
      .replace(/Ã©/g, 'é')
      .replace(/Ãº/g, 'ú')
      .replace(/Ã³/g, 'ó');
    if (beforeEncoding !== normalized) {
      changes.push('fixed_encoding');
    }

    // Normalize line breaks
    normalized = normalized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    return {
      original: text,
      normalized,
      changes,
    };
  }

  /**
   * Normalize organization name
   */
  static normalizeOrgaoName(name: string | undefined | null): string | null {
    if (!name) return null;

    let normalized = this.normalize(name)?.normalized || name;

    // Standardize common abbreviations
    normalized = normalized
      .replace(/\bPREF\b\.?/gi, 'Prefeitura')
      .replace(/\bCAM\b\.?/gi, 'Câmara')
      .replace(/\bMUN\b\.?/gi, 'Municipal');

    // Capitalize properly
    normalized = normalized
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());

    return normalized;
  }

  /**
   * Normalize cargo (position) name
   */
  static normalizeCargoName(name: string | undefined | null): string | null {
    if (!name) return null;

    let normalized = this.normalize(name)?.normalized || name;

    // Remove excessive parentheses content
    normalized = normalized.replace(/\([^)]{50,}\)/g, '');

    // Capitalize properly (but keep acronyms)
    const words = normalized.split(' ');
    normalized = words
      .map((word) => {
        // Keep acronyms uppercase
        if (word.length <= 3 && word === word.toUpperCase()) {
          return word;
        }
        // Capitalize first letter
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      })
      .join(' ');

    return normalized.trim();
  }
}

/**
 * Main enricher service
 */
export class ConcursoEnricher {
  /**
   * Enrich full concurso data object
   */
  static enrichConcursoData(data: any): any {
    const enriched = { ...data };
    const warnings: string[] = [];
    const enrichedFields: string[] = [];

    // Enrich dates
    if (data.datas) {
      enriched.datas = this.enrichDates(data.datas, warnings);
      if (Object.keys(enriched.datas).length > 0) {
        enrichedFields.push('datas');
      }
    }

    // Enrich cargos (positions)
    if (data.cargos && Array.isArray(data.cargos)) {
      enriched.cargos = data.cargos.map((cargo: any) => 
        this.enrichCargo(cargo, warnings)
      );
      enrichedFields.push('cargos');
    }

    // Enrich taxas (fees)
    if (data.taxas && Array.isArray(data.taxas)) {
      enriched.taxas = data.taxas.map((taxa: any) => 
        this.enrichTaxa(taxa, warnings)
      );
      enrichedFields.push('taxas');
    }

    // Enrich banca
    if (data.banca) {
      enriched.banca = this.enrichBanca(data.banca, warnings);
      enrichedFields.push('banca');
    }

    // Enrich orgao name
    if (data.orgao) {
      const normalized = TextNormalizer.normalizeOrgaoName(data.orgao);
      if (normalized && normalized !== data.orgao) {
        enriched.orgao = normalized;
        enrichedFields.push('orgao');
      }
    }

    // Enrich edital numero
    if (data.editalNumero) {
      const normalized = TextNormalizer.normalize(data.editalNumero);
      if (normalized && normalized.normalized !== data.editalNumero) {
        enriched.editalNumero = normalized.normalized;
        enrichedFields.push('editalNumero');
      }
    }

    // Add enrichment metadata
    enriched._enrichment = {
      enrichedFields,
      warnings,
      enrichedAt: new Date().toISOString(),
    };

    return enriched;
  }

  /**
   * Enrich dates object
   */
  private static enrichDates(datas: any, warnings: string[]): any {
    const enriched: any = {};

    for (const [key, value] of Object.entries(datas)) {
      if (typeof value === 'string') {
        const enrichedDate = DateValidator.normalize(value);
        
        if (enrichedDate?.valid) {
          enriched[key] = enrichedDate.normalized;
          enriched[`${key}_enriched`] = enrichedDate;
        } else {
          enriched[key] = value;
          warnings.push(`Invalid date for ${key}: ${value}`);
        }
      } else {
        enriched[key] = value;
      }
    }

    // Validate date ranges
    if (enriched.inscricoesInicio && enriched.inscricoesFim) {
      const validation = DateValidator.validateRange(
        enriched.inscricoesInicio,
        enriched.inscricoesFim
      );
      if (!validation.valid) {
        warnings.push(...validation.errors);
      }
    }

    return enriched;
  }

  /**
   * Enrich cargo (position) data
   */
  private static enrichCargo(cargo: any, warnings: string[]): any {
    const enriched = { ...cargo };

    // Normalize cargo name
    if (cargo.cargo) {
      const normalized = TextNormalizer.normalizeCargoName(cargo.cargo);
      if (normalized) {
        enriched.cargo = normalized;
      }
    }

    // Normalize salary
    if (cargo.salario) {
      const enrichedSalary = MoneyValidator.normalize(cargo.salario);
      if (enrichedSalary?.valid) {
        enriched.salario = enrichedSalary.normalized;
        enriched.salario_formatted = enrichedSalary.formatted;
        if (enrichedSalary.warnings.length > 0) {
          warnings.push(...enrichedSalary.warnings.map(w => `${cargo.cargo}: ${w}`));
        }
      }
    }

    // Normalize requisitos text
    if (cargo.requisitos) {
      const normalized = TextNormalizer.normalize(cargo.requisitos);
      if (normalized) {
        enriched.requisitos = normalized.normalized;
      }
    }

    return enriched;
  }

  /**
   * Enrich taxa (fee) data
   */
  private static enrichTaxa(taxa: any, warnings: string[]): any {
    const enriched = { ...taxa };

    if (taxa.valor) {
      const enrichedValue = MoneyValidator.normalize(taxa.valor);
      if (enrichedValue?.valid) {
        enriched.valor = enrichedValue.normalized;
        enriched.valor_formatted = enrichedValue.formatted;
        if (enrichedValue.warnings.length > 0) {
          warnings.push(...enrichedValue.warnings.map(w => `Taxa: ${w}`));
        }
      }
    }

    return enriched;
  }

  /**
   * Enrich banca (organization) data
   */
  private static enrichBanca(banca: any, warnings: string[]): any {
    const enriched = { ...banca };

    // Normalize banca name
    if (banca.nome) {
      const normalized = TextNormalizer.normalize(banca.nome);
      if (normalized) {
        enriched.nome = normalized.normalized;
      }
    }

    // Validate and normalize CNPJ
    if (banca.cnpj) {
      const enrichedCNPJ = CNPJValidator.normalize(banca.cnpj);
      if (enrichedCNPJ) {
        enriched.cnpj = enrichedCNPJ.normalized;
        enriched.cnpj_valid = enrichedCNPJ.valid;
        
        if (!enrichedCNPJ.valid) {
          warnings.push(`Invalid CNPJ for banca: ${banca.cnpj}`);
        }
      }
    }

    return enriched;
  }
}

