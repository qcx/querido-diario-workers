/**
 * Concurso Findings Repository
 * Handles database operations for concurso findings
 */

import { eq, and, desc, gte, lte } from 'drizzle-orm';
import { DatabaseClient, schema } from '../client';
import type { Finding } from '../../analysis/analyzers/base-analyzer';

export interface ConcursoFindingRecord {
  id: string;
  analysisJobId: string;
  gazetteId: string;
  territoryId: string;
  documentType: string | null;
  confidence: number | null;
  orgao: string | null;
  editalNumero: string | null;
  totalVagas: number;
  cargos: any[];
  datas: Record<string, any>;
  taxas: any[];
  banca: Record<string, any>;
  extractionMethod: string | null;
  createdAt: string;
}

export class ConcursoFindingsRepository {
  constructor(private client: DatabaseClient) {}

  /**
   * Store a concurso finding from analysis
   */
  async storeConcursoFinding(
    finding: Finding,
    analysisJobId: string,
    gazetteId: string,
    territoryId: string
  ): Promise<string> {
    const db = this.client.getDb();
    const id = this.client.generateId();

    try {
      // Extract concurso data from finding
      const concursoData = finding.data.concursoData || finding.data;
      
      const record = {
        id,
        analysisJobId,
        gazetteId,
        territoryId: finding.data.territoryId || territoryId,
        documentType: concursoData.documentType || null,
        confidence: finding.confidence || null,
        orgao: concursoData.orgao || null,
        editalNumero: concursoData.editalNumero || null,
        totalVagas: concursoData.vagas?.total || concursoData.totalVagas || 0,
        cargos: this.client.stringifyJson(concursoData.vagas?.porCargo || concursoData.cargos || []),
        datas: this.client.stringifyJson(concursoData.datas || {}),
        taxas: this.client.stringifyJson(concursoData.taxas || []),
        banca: this.client.stringifyJson(concursoData.banca || {}),
        extractionMethod: finding.data.extractionMethod || concursoData.extractionMethod || 'keyword',
        createdAt: this.client.getCurrentTimestamp()
      };

      const result = await db
        .insert(schema.concursoFindings)
        .values(record)
        .returning({ id: schema.concursoFindings.id });

      return result[0].id;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Get concurso findings by analysis job ID
   */
  async getConcursoFindingsByAnalysisJobId(
    analysisJobId: string
  ): Promise<ConcursoFindingRecord[]> {
    const db = this.client.getDb();

    try {
      const results = await db
        .select()
        .from(schema.concursoFindings)
        .where(eq(schema.concursoFindings.analysisJobId, analysisJobId))
        .orderBy(desc(schema.concursoFindings.createdAt));

      return results.map(record => ({
        ...record,
        totalVagas: record.totalVagas || 0,
        cargos: this.client.parseJson(record.cargos, []),
        datas: this.client.parseJson(record.datas, {}),
        taxas: this.client.parseJson(record.taxas, []),
        banca: this.client.parseJson(record.banca, {})
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get concurso findings by gazette ID
   */
  async getConcursoFindingsByGazetteId(
    gazetteId: string
  ): Promise<ConcursoFindingRecord[]> {
    const db = this.client.getDb();

    try {
      const results = await db
        .select()
        .from(schema.concursoFindings)
        .where(eq(schema.concursoFindings.gazetteId, gazetteId))
        .orderBy(desc(schema.concursoFindings.createdAt));

      return results.map(record => ({
        ...record,
        totalVagas: record.totalVagas || 0,
        cargos: this.client.parseJson(record.cargos, []),
        datas: this.client.parseJson(record.datas, {}),
        taxas: this.client.parseJson(record.taxas, []),
        banca: this.client.parseJson(record.banca, {})
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get concurso findings by territory
   */
  async getConcursoFindingsByTerritory(
    territoryId: string,
    days: number = 30,
    limit: number = 50
  ): Promise<ConcursoFindingRecord[]> {
    const db = this.client.getDb();

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffDateStr = cutoffDate.toISOString();

      const results = await db
        .select()
        .from(schema.concursoFindings)
        .where(
          and(
            eq(schema.concursoFindings.territoryId, territoryId),
            gte(schema.concursoFindings.createdAt, cutoffDateStr)
          )
        )
        .orderBy(desc(schema.concursoFindings.createdAt))
        .limit(limit);

      return results.map(record => ({
        ...record,
        totalVagas: record.totalVagas || 0,
        cargos: this.client.parseJson(record.cargos, []),
        datas: this.client.parseJson(record.datas, {}),
        taxas: this.client.parseJson(record.taxas, []),
        banca: this.client.parseJson(record.banca, {})
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get concurso finding by ID
   */
  async getConcursoFindingById(id: string): Promise<ConcursoFindingRecord | null> {
    const db = this.client.getDb();

    try {
      const results = await db
        .select()
        .from(schema.concursoFindings)
        .where(eq(schema.concursoFindings.id, id))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const record = results[0];
      return {
        ...record,
        totalVagas: record.totalVagas || 0,
        cargos: this.client.parseJson(record.cargos, []),
        datas: this.client.parseJson(record.datas, {}),
        taxas: this.client.parseJson(record.taxas, []),
        banca: this.client.parseJson(record.banca, {})
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Count concurso findings by territory
   */
  async countConcursoFindingsByTerritory(
    territoryId: string,
    startDate?: string,
    endDate?: string
  ): Promise<number> {
    const db = this.client.getDb();

    try {
      const conditions = [eq(schema.concursoFindings.territoryId, territoryId)];

      if (startDate) {
        conditions.push(gte(schema.concursoFindings.createdAt, startDate));
      }

      if (endDate) {
        conditions.push(lte(schema.concursoFindings.createdAt, endDate));
      }

      const results = await db
        .select({ count: schema.concursoFindings.id })
        .from(schema.concursoFindings)
        .where(conditions.length > 1 ? and(...conditions) : conditions[0]);

      return results.length;
    } catch (error) {
      return 0;
    }
  }
}

