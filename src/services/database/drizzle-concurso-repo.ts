/**
 * Drizzle-based Concurso Repository
 * Replaces concurso-repo.ts with Drizzle ORM implementation
 */

import { eq, desc, and, gte, lte, like } from 'drizzle-orm';
import { DrizzleDatabaseClient, schema } from './drizzle-client';
import { logger } from '../../utils/logger';
import type { ConcursoFinding } from '../../types';
import type { 
  ConcursoCargo, 
  ConcursoDatas, 
  ConcursoTaxa, 
  ConcursoBanca 
} from '../../types/database';

export interface ConcursoRecord {
  id: string;
  analysisJobId: string;
  gazetteId: string;
  territoryId: string;
  documentType: string | null;
  confidence: number | null;
  orgao: string | null;
  editalNumero: string | null;
  totalVagas: number;
  cargos: ConcursoCargo[];
  datas: ConcursoDatas;
  taxas: ConcursoTaxa[];
  banca: ConcursoBanca;
  extractionMethod: string | null;
  createdAt: string;
}

export interface ConcursoSearchFilters {
  territoryId?: string;
  orgao?: string;
  minVagas?: number;
  startDate?: string;
  endDate?: string;
  minConfidence?: number;
}

export class DrizzleConcursoRepository {
  constructor(private dbClient: DrizzleDatabaseClient) {}

  /**
   * Get concurso findings by analysis job ID
   */
  async getConcursoFindingsByAnalysisJobId(analysisJobId: string): Promise<ConcursoRecord[]> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.concursoFindings)
        .where(eq(schema.concursoFindings.analysisJobId, analysisJobId));

      return results.map(record => ({
        ...record,
        cargos: this.dbClient.parseJson<ConcursoCargo[]>(record.cargos, []),
        datas: this.dbClient.parseJson<ConcursoDatas>(record.datas, {}),
        taxas: this.dbClient.parseJson<ConcursoTaxa[]>(record.taxas, []),
        banca: this.dbClient.parseJson<ConcursoBanca>(record.banca, {}),
      }));
    } catch (error) {
      logger.error('Failed to get concurso findings by analysis job ID', {
        analysisJobId,
        error
      });
      throw error;
    }
  }

  /**
   * Store concurso finding from analysis
   */
  async storeConcursoFinding(finding: ConcursoFinding, analysisJobId: string): Promise<string> {
    try {
      const db = this.dbClient.getDb();

      // Get gazette ID from analysis
      const gazetteResults = await db.select({ gazetteId: schema.analysisResults.gazetteId })
        .from(schema.analysisResults)
        .where(eq(schema.analysisResults.jobId, analysisJobId))
        .limit(1);

      if (gazetteResults.length === 0) {
        throw new Error(`Analysis not found for job ID: ${analysisJobId}`);
      }

      const gazetteId = gazetteResults[0].gazetteId;
      const concursoData = finding.data.concursoData;

      const concursoRecord = {
        id: this.dbClient.generateId(),
        analysisJobId,
        gazetteId,
        territoryId: finding.data.territoryId || 'unknown',
        documentType: concursoData?.documentType || null,
        confidence: finding.confidence || null,
        orgao: concursoData?.orgao || null,
        editalNumero: concursoData?.editalNumero || null,
        totalVagas: concursoData?.vagas?.total ?? 0,
        cargos: this.dbClient.stringifyJson(concursoData?.vagas?.porCargo || []),
        datas: this.dbClient.stringifyJson(concursoData?.datas || {}),
        taxas: this.dbClient.stringifyJson(concursoData?.taxas || []),
        banca: this.dbClient.stringifyJson(concursoData?.banca || {}),
        extractionMethod: finding.data.extractionMethod || 'unknown',
        createdAt: this.dbClient.getCurrentTimestamp()
      };

      const result = await db.insert(schema.concursoFindings)
        .values(concursoRecord)
        .returning({ id: schema.concursoFindings.id });

      logger.info('Concurso finding stored', {
        concursoId: result[0].id,
        analysisJobId,
        orgao: concursoData?.orgao,
        totalVagas: concursoData?.vagas?.total || 0
      });

      return result[0].id;
    } catch (error) {
      logger.error('Failed to store concurso finding', {
        analysisJobId,
        error
      });
      throw error;
    }
  }

  /**
   * Search concursos with filters
   */
  async searchConcursos(
    filters: ConcursoSearchFilters = {},
    limit: number = 100,
    offset: number = 0
  ): Promise<{
    concursos: ConcursoRecord[];
    total: number;
  }> {
    try {
      const db = this.dbClient.getDb();

      // Build where conditions
      const conditions = [];

      if (filters.territoryId) {
        conditions.push(eq(schema.concursoFindings.territoryId, filters.territoryId));
      }

      if (filters.orgao) {
        conditions.push(like(schema.concursoFindings.orgao, `%${filters.orgao}%`));
      }

      if (filters.minVagas) {
        conditions.push(gte(schema.concursoFindings.totalVagas, filters.minVagas));
      }

      if (filters.startDate) {
        conditions.push(gte(schema.concursoFindings.createdAt, filters.startDate));
      }

      if (filters.endDate) {
        conditions.push(lte(schema.concursoFindings.createdAt, filters.endDate));
      }

      if (filters.minConfidence) {
        conditions.push(gte(schema.concursoFindings.confidence, filters.minConfidence));
      }

      // Get paginated results
      let query = db.select()
        .from(schema.concursoFindings);

      if (conditions.length > 0) {
        query = query.where(and(...conditions));
      }

      const concursos = await query
        .orderBy(desc(schema.concursoFindings.createdAt))
        .limit(limit)
        .offset(offset);

      // Get total count
      let countQuery = db.select({ count: schema.concursoFindings.id })
        .from(schema.concursoFindings);

      if (conditions.length > 0) {
        countQuery = countQuery.where(and(...conditions));
      }

      const totalResults = await countQuery;

      const records = concursos.map(concurso => ({
        ...concurso,
        cargos: this.dbClient.parseJson<ConcursoCargo[]>(concurso.cargos, []),
        datas: this.dbClient.parseJson<ConcursoDatas>(concurso.datas, {}),
        taxas: this.dbClient.parseJson<ConcursoTaxa[]>(concurso.taxas, []),
        banca: this.dbClient.parseJson<ConcursoBanca>(concurso.banca, {})
      }));

      return {
        concursos: records,
        total: totalResults.length
      };
    } catch (error) {
      logger.error('Failed to search concursos', {
        filters,
        error
      });
      throw error;
    }
  }

  /**
   * Get concurso by ID
   */
  async getConcursoById(id: string): Promise<ConcursoRecord | null> {
    try {
      const db = this.dbClient.getDb();

      const results = await db.select()
        .from(schema.concursoFindings)
        .where(eq(schema.concursoFindings.id, id))
        .limit(1);

      if (results.length === 0) {
        return null;
      }

      const concurso = results[0];
      return {
        ...concurso,
        totalVagas: concurso.totalVagas ?? 0,
        cargos: this.dbClient.parseJson<ConcursoCargo[]>(concurso.cargos, []),
        datas: this.dbClient.parseJson<ConcursoDatas>(concurso.datas, {}),
        taxas: this.dbClient.parseJson<ConcursoTaxa[]>(concurso.taxas, []),
        banca: this.dbClient.parseJson<ConcursoBanca>(concurso.banca, {})
      };
    } catch (error) {
      logger.error('Failed to get concurso by ID', {
        id,
        error
      });
      throw error;
    }
  }

  /**
   * Get concursos by territory
   */
  async getConcursosByTerritory(
    territoryId: string,
    days: number = 30,
    limit: number = 50
  ): Promise<ConcursoRecord[]> {
    try {
      const db = this.dbClient.getDb();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffDateStr = cutoffDate.toISOString();

      const concursos = await db.select()
        .from(schema.concursoFindings)
        .where(and(
          eq(schema.concursoFindings.territoryId, territoryId),
          gte(schema.concursoFindings.createdAt, cutoffDateStr)
        ))
        .orderBy(desc(schema.concursoFindings.createdAt))
        .limit(limit);

      return concursos.map(concurso => ({
        ...concurso,
        cargos: this.dbClient.parseJson<ConcursoCargo[]>(concurso.cargos, []),
        datas: this.dbClient.parseJson<ConcursoDatas>(concurso.datas, {}),
        taxas: this.dbClient.parseJson<ConcursoTaxa[]>(concurso.taxas, []),
        banca: this.dbClient.parseJson<ConcursoBanca>(concurso.banca, {})
      }));
    } catch (error) {
      logger.error('Failed to get concursos by territory', {
        territoryId,
        days,
        error
      });
      throw error;
    }
  }

  /**
   * Get concurso statistics
   */
  async getConcursoStats(days: number = 30): Promise<{
    totalConcursos: number;
    totalVagas: number;
    topOrgaos: { orgao: string; count: number; totalVagas: number }[];
    topTerritories: { territory: string; count: number }[];
    averageVagasPerConcurso: number;
  }> {
    try {
      const db = this.dbClient.getDb();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      const cutoffDateStr = cutoffDate.toISOString();

      const concursos = await db.select()
        .from(schema.concursoFindings)
        .where(gte(schema.concursoFindings.createdAt, cutoffDateStr));

      if (concursos.length === 0) {
        return {
          totalConcursos: 0,
          totalVagas: 0,
          topOrgaos: [],
          topTerritories: [],
          averageVagasPerConcurso: 0
        };
      }

      const totalConcursos = concursos.length;
      const totalVagas = concursos.reduce((sum, c) => sum + (c.totalVagas || 0), 0);
      const averageVagasPerConcurso = Math.round(totalVagas / totalConcursos);

      // Count by orgao
      const orgaoStats: Record<string, { count: number; totalVagas: number }> = {};
      concursos.forEach(concurso => {
        if (concurso.orgao) {
          if (!orgaoStats[concurso.orgao]) {
            orgaoStats[concurso.orgao] = { count: 0, totalVagas: 0 };
          }
          orgaoStats[concurso.orgao].count++;
          orgaoStats[concurso.orgao].totalVagas += concurso.totalVagas || 0;
        }
      });

      const topOrgaos = Object.entries(orgaoStats)
        .map(([orgao, stats]) => ({
          orgao,
          count: stats.count,
          totalVagas: stats.totalVagas
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      // Count by territory
      const territoryCount: Record<string, number> = {};
      concursos.forEach(concurso => {
        territoryCount[concurso.territoryId] = (territoryCount[concurso.territoryId] || 0) + 1;
      });

      const topTerritories = Object.entries(territoryCount)
        .map(([territory, count]) => ({ territory, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      return {
        totalConcursos,
        totalVagas,
        topOrgaos,
        topTerritories,
        averageVagasPerConcurso
      };
    } catch (error) {
      logger.error('Failed to get concurso stats', {
        days,
        error
      });
      throw error;
    }
  }

  /**
   * Search concursos by text (simple search in orgao and edital number)
   */
  async searchByText(
    searchTerm: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{
    concursos: ConcursoRecord[];
    total: number;
  }> {
    try {
      const db = this.dbClient.getDb();

      // Search in orgao or edital numero
      const conditions = [
        like(schema.concursoFindings.orgao, `%${searchTerm}%`),
        like(schema.concursoFindings.editalNumero, `%${searchTerm}%`)
      ];

      const concursos = await db.select()
        .from(schema.concursoFindings)
        .where(conditions.length > 1 ? conditions.reduce((acc, curr) => acc.or(curr)) : conditions[0])
        .orderBy(desc(schema.concursoFindings.createdAt))
        .limit(limit)
        .offset(offset);

      const totalResults = await db.select({ count: schema.concursoFindings.id })
        .from(schema.concursoFindings)
        .where(conditions.length > 1 ? conditions.reduce((acc, curr) => acc.or(curr)) : conditions[0]);

      const records = concursos.map(concurso => ({
        ...concurso,
        cargos: this.dbClient.parseJson<ConcursoCargo[]>(concurso.cargos, []),
        datas: this.dbClient.parseJson<ConcursoDatas>(concurso.datas, {}),
        taxas: this.dbClient.parseJson<ConcursoTaxa[]>(concurso.taxas, []),
        banca: this.dbClient.parseJson<ConcursoBanca>(concurso.banca, {})
      }));

      return {
        concursos: records,
        total: totalResults.length
      };
    } catch (error) {
      logger.error('Failed to search concursos by text', {
        searchTerm: searchTerm.substring(0, 50),
        error
      });
      throw error;
    }
  }

  /**
   * Get high-value concursos (those with many positions)
   */
  async getHighValueConcursos(
    minVagas: number = 10,
    limit: number = 50
  ): Promise<ConcursoRecord[]> {
    try {
      const db = this.dbClient.getDb();

      const concursos = await db.select()
        .from(schema.concursoFindings)
        .where(gte(schema.concursoFindings.totalVagas, minVagas))
        .orderBy(desc(schema.concursoFindings.totalVagas))
        .limit(limit);

      return concursos.map(concurso => ({
        ...concurso,
        cargos: this.dbClient.parseJson<ConcursoCargo[]>(concurso.cargos, []),
        datas: this.dbClient.parseJson<ConcursoDatas>(concurso.datas, {}),
        taxas: this.dbClient.parseJson<ConcursoTaxa[]>(concurso.taxas, []),
        banca: this.dbClient.parseJson<ConcursoBanca>(concurso.banca, {})
      }));
    } catch (error) {
      logger.error('Failed to get high-value concursos', {
        minVagas,
        error
      });
      throw error;
    }
  }
}
