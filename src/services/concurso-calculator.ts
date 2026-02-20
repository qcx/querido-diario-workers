/**
 * Concurso Calculator Service
 * Performs automatic calculations and inferences on concurso data
 */

import { logger } from '../utils';
import { differenceInDays, parseISO, isAfter, isBefore, isValid } from 'date-fns';
import { DateValidator } from './concurso-enricher';

export interface ConcursoStatus {
  status: 'aberto' | 'fechado' | 'em_andamento' | 'finalizado' | 'cancelado' | 'suspenso' | 'desconhecido';
  confidence: number;
  reason: string;
}

export interface VagasCalculation {
  totalCalculado: number;
  totalDeclarado?: number;
  discrepancia: boolean;
  porCargo: number;
  reservaPCD?: number;
  reservaAmplaConcorrencia?: number;
}

export interface PrazosCalculation {
  diasAteInscricaoFim?: number;
  diasAteProva?: number;
  periodoInscricaoDias?: number;
  inscricoesAbertas?: boolean;
  provaFutura?: boolean;
}

export interface TaxaCalculation {
  media?: number;
  minima?: number;
  maxima?: number;
  variacao: boolean;
}

export interface DataQualityMetrics {
  completeness: number; // 0-1
  validatedFields: string[];
  missingFields: string[];
  warnings: string[];
  confidence: number; // 0-1
}

/**
 * Calculator for concurso data
 */
export class ConcursoCalculator {
  /**
   * Calculate total vacancies from cargos
   */
  static calculateTotalVagas(data: any): VagasCalculation {
    const result: VagasCalculation = {
      totalCalculado: 0,
      porCargo: 0,
      discrepancia: false,
    };

    // Calculate from porCargo array
    if (data.vagas?.porCargo && Array.isArray(data.vagas.porCargo)) {
      result.porCargo = data.vagas.porCargo.length;
      result.totalCalculado = data.vagas.porCargo.reduce(
        (sum: number, cargo: any) => sum + (cargo.vagas || 0),
        0
      );
    }

    // Get declared total
    if (data.vagas?.total) {
      result.totalDeclarado = data.vagas.total;
    }

    // Get reservations
    if (data.vagas?.reservaPCD) {
      result.reservaPCD = data.vagas.reservaPCD;
    }
    if (data.vagas?.reservaAmplaConcorrencia) {
      result.reservaAmplaConcorrencia = data.vagas.reservaAmplaConcorrencia;
    }

    // Check for discrepancy
    if (result.totalDeclarado && result.totalCalculado > 0) {
      if (result.totalDeclarado !== result.totalCalculado) {
        result.discrepancia = true;
      }
    }

    return result;
  }

  /**
   * Calculate deadlines and time-based information
   */
  static calculatePrazos(data: any, referenceDate: Date = new Date()): PrazosCalculation {
    const result: PrazosCalculation = {};

    if (!data.datas) return result;

    try {
      // Parse inscription end date
      if (data.datas.inscricoesFim) {
        const inscricaoFimDate = this.parseDate(data.datas.inscricoesFim);
        if (inscricaoFimDate) {
          result.diasAteInscricaoFim = differenceInDays(inscricaoFimDate, referenceDate);
          result.inscricoesAbertas = result.diasAteInscricaoFim >= 0;
        }
      }

      // Parse exam date
      if (data.datas.prova) {
        const provaDate = this.parseDate(data.datas.prova);
        if (provaDate) {
          result.diasAteProva = differenceInDays(provaDate, referenceDate);
          result.provaFutura = result.diasAteProva > 0;
        }
      }

      // Calculate inscription period length
      if (data.datas.inscricoesInicio && data.datas.inscricoesFim) {
        const inicioDate = this.parseDate(data.datas.inscricoesInicio);
        const fimDate = this.parseDate(data.datas.inscricoesFim);
        
        if (inicioDate && fimDate) {
          result.periodoInscricaoDias = differenceInDays(fimDate, inicioDate);
        }
      }
    } catch (error) {
      logger.debug('Failed to calculate prazos', { error });
    }

    return result;
  }

  /**
   * Infer concurso status based on available data
   */
  static inferStatus(data: any, prazos: PrazosCalculation): ConcursoStatus {
    const result: ConcursoStatus = {
      status: 'desconhecido',
      confidence: 0,
      reason: '',
    };

    // Check document type first
    if (data.documentType === 'cancelamento') {
      result.status = 'cancelado';
      result.confidence = 0.95;
      result.reason = 'Document type indicates cancellation';
      return result;
    }

    if (data.status) {
      const statusLower = data.status.toLowerCase();
      if (statusLower.includes('cancel')) {
        result.status = 'cancelado';
        result.confidence = 0.9;
        result.reason = 'Status field indicates cancellation';
        return result;
      }
      if (statusLower.includes('suspend')) {
        result.status = 'suspenso';
        result.confidence = 0.9;
        result.reason = 'Status field indicates suspension';
        return result;
      }
    }

    // Check based on dates
    if (prazos.inscricoesAbertas !== undefined) {
      if (prazos.inscricoesAbertas) {
        result.status = 'aberto';
        result.confidence = 0.85;
        result.reason = 'Inscriptions are still open';
        return result;
      } else {
        // Inscriptions closed
        if (prazos.provaFutura) {
          result.status = 'em_andamento';
          result.confidence = 0.8;
          result.reason = 'Inscriptions closed but exam is in the future';
          return result;
        } else if (prazos.diasAteProva !== undefined && prazos.diasAteProva < 0) {
          // Exam already happened
          if (Math.abs(prazos.diasAteProva) < 90) {
            result.status = 'em_andamento';
            result.confidence = 0.7;
            result.reason = 'Exam recently occurred, likely in result phase';
          } else {
            result.status = 'finalizado';
            result.confidence = 0.6;
            result.reason = 'Exam occurred more than 90 days ago';
          }
          return result;
        } else {
          result.status = 'fechado';
          result.confidence = 0.7;
          result.reason = 'Inscriptions closed';
          return result;
        }
      }
    }

    // Check document type for other indicators
    if (data.documentType === 'edital_abertura') {
      result.status = 'aberto';
      result.confidence = 0.7;
      result.reason = 'Opening notice document type';
      return result;
    }

    if (data.documentType === 'homologacao' || data.documentType === 'resultado_parcial') {
      result.status = 'em_andamento';
      result.confidence = 0.75;
      result.reason = 'Results phase document type';
      return result;
    }

    if (data.documentType === 'convocacao') {
      result.status = 'finalizado';
      result.confidence = 0.8;
      result.reason = 'Candidate convocation indicates final phase';
      return result;
    }

    result.reason = 'Insufficient data to determine status';
    return result;
  }

  /**
   * Calculate taxa (fee) statistics
   */
  static calculateTaxaStats(data: any): TaxaCalculation {
    const result: TaxaCalculation = {
      variacao: false,
    };

    if (!data.taxas || !Array.isArray(data.taxas) || data.taxas.length === 0) {
      return result;
    }

    const valores = data.taxas
      .map((taxa: any) => taxa.valor)
      .filter((v: any) => typeof v === 'number' && v > 0);

    if (valores.length === 0) return result;

    result.minima = Math.min(...valores);
    result.maxima = Math.max(...valores);
    result.media = valores.reduce((sum: number, v: number) => sum + v, 0) / valores.length;
    result.variacao = result.minima !== result.maxima;

    return result;
  }

  /**
   * Validate data consistency
   */
  static validateConsistency(data: any): string[] {
    const warnings: string[] = [];

    // Check vacancies consistency
    const vagasCalc = this.calculateTotalVagas(data);
    if (vagasCalc.discrepancia) {
      warnings.push(
        `Total de vagas declarado (${vagasCalc.totalDeclarado}) difere do calculado (${vagasCalc.totalCalculado})`
      );
    }

    // Check date order
    if (data.datas) {
      const { inscricoesInicio, inscricoesFim, prova } = data.datas;
      
      if (inscricoesInicio && inscricoesFim) {
        const inicio = this.parseDate(inscricoesInicio);
        const fim = this.parseDate(inscricoesFim);
        
        if (inicio && fim && isAfter(inicio, fim)) {
          warnings.push('Data de início de inscrições é posterior à data de fim');
        }
      }

      if (inscricoesFim && prova) {
        const fim = this.parseDate(inscricoesFim);
        const provaDate = this.parseDate(prova);
        
        if (fim && provaDate && isAfter(fim, provaDate)) {
          warnings.push('Data de fim de inscrições é posterior à data da prova');
        }
      }
    }

    // Check if salario values are reasonable
    if (data.vagas?.porCargo) {
      for (const cargo of data.vagas.porCargo) {
        if (cargo.salario && (cargo.salario < 1000 || cargo.salario > 100000)) {
          warnings.push(`Salário suspeito para cargo ${cargo.cargo}: R$ ${cargo.salario}`);
        }
      }
    }

    return warnings;
  }

  /**
   * Calculate data quality metrics
   */
  static calculateDataQuality(data: any): DataQualityMetrics {
    const validatedFields: string[] = [];
    const missingFields: string[] = [];
    const warnings: string[] = [];

    // Essential fields for an edital de abertura
    const essentialFields = [
      { key: 'orgao', weight: 1.0 },
      { key: 'editalNumero', weight: 0.8 },
      { key: 'vagas.total', weight: 1.0 },
      { key: 'datas.inscricoesInicio', weight: 0.9 },
      { key: 'datas.inscricoesFim', weight: 1.0 },
      { key: 'taxas', weight: 0.7 },
      { key: 'banca.nome', weight: 0.5 },
    ];

    let totalWeight = 0;
    let achievedWeight = 0;

    for (const field of essentialFields) {
      totalWeight += field.weight;
      
      const value = this.getNestedValue(data, field.key);
      if (value !== undefined && value !== null && value !== '') {
        validatedFields.push(field.key);
        achievedWeight += field.weight;
      } else {
        missingFields.push(field.key);
      }
    }

    // Calculate completeness
    const completeness = totalWeight > 0 ? achievedWeight / totalWeight : 0;

    // Add consistency warnings
    const consistencyWarnings = this.validateConsistency(data);
    warnings.push(...consistencyWarnings);

    // Calculate confidence based on completeness and warnings
    let confidence = completeness;
    
    // Reduce confidence for each warning
    confidence -= warnings.length * 0.05;
    confidence = Math.max(0, Math.min(1, confidence));

    return {
      completeness: Math.round(completeness * 100) / 100,
      validatedFields,
      missingFields,
      warnings,
      confidence: Math.round(confidence * 100) / 100,
    };
  }

  /**
   * Enrich concurso data with calculations
   */
  static enrichWithCalculations(data: any): any {
    const enriched = { ...data };

    // Calculate vacancies
    const vagasCalc = this.calculateTotalVagas(data);
    if (!enriched._calculations) {
      enriched._calculations = {};
    }
    enriched._calculations.vagas = vagasCalc;

    // Calculate prazos
    const prazosCalc = this.calculatePrazos(data);
    enriched._calculations.prazos = prazosCalc;

    // Infer status
    const status = this.inferStatus(data, prazosCalc);
    enriched._calculations.status = status;

    // Calculate taxa stats
    const taxaStats = this.calculateTaxaStats(data);
    enriched._calculations.taxas = taxaStats;

    // Calculate data quality
    const quality = this.calculateDataQuality(data);
    enriched._dataQuality = quality;

    // Add calculation timestamp
    enriched._calculations.calculatedAt = new Date().toISOString();

    return enriched;
  }

  /**
   * Parse date string to Date object
   */
  private static parseDate(dateStr: string): Date | null {
    const enrichedDate = DateValidator.normalize(dateStr);
    if (enrichedDate?.valid && enrichedDate.normalized) {
      const date = parseISO(enrichedDate.normalized);
      return isValid(date) ? date : null;
    }
    return null;
  }

  /**
   * Get nested value from object using dot notation
   */
  private static getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }
}

