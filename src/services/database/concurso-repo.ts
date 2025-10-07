/**
 * Concurso Repository
 * Handles specialized queries for concurso público findings
 */

import { DatabaseClient } from './client';
import { ConcursoData, ConcursoFinding } from '../../types/analysis';
import { logger } from '../../utils';

export interface ConcursoRecord {
  id: string;
  analysisJobId: string;
  gazetteId: string;
  territoryId: string;
  documentType?: string;
  confidence: number;
  orgao?: string;
  editalNumero?: string;
  totalVagas: number;
  cargos: any[];
  datas: any;
  taxas: any[];
  banca: any;
  extractionMethod?: string;
  createdAt: string;
}

export interface ConcursoSearchFilters {
  territories?: string[];
  startDate?: string;
  endDate?: string;
  minVagas?: number;
  orgaos?: string[];
  documentTypes?: string[];
  minConfidence?: number;
}

export class ConcursoRepository {
  constructor(private db: DatabaseClient) {}

  /**
   * Store concurso findings from analysis
   */
  async storeConcursoFinding(finding: ConcursoFinding, analysisJobId: string): Promise<string> {
    try {
      // Get gazette ID from analysis
      const gazetteResult = await this.db.queryTemplate`
        SELECT gazette_id FROM analysis_results WHERE job_id = ${analysisJobId}
      `;

      if (gazetteResult.length === 0) {
        throw new Error(`Analysis not found for job ID: ${analysisJobId}`);
      }

      const gazetteId = gazetteResult[0].gazette_id;
      const concursoData = finding.data.concursoData;

      const result = await this.db.queryTemplate`
        INSERT INTO concurso_findings (
          analysis_job_id, gazette_id, territory_id, document_type, confidence,
          orgao, edital_numero, total_vagas, cargos, datas, taxas, banca, extraction_method
        )
        VALUES (
          ${analysisJobId}, ${gazetteId}, ${finding.data.territoryId || 'unknown'},
          ${concursoData?.documentType || null}, ${finding.confidence},
          ${concursoData?.orgao || null}, ${concursoData?.editalNumero || null},
          ${concursoData?.vagas?.total || 0}, ${JSON.stringify(concursoData?.vagas?.porCargo || [])},
          ${JSON.stringify(concursoData?.datas || {})}, ${JSON.stringify(concursoData?.taxas || [])},
          ${JSON.stringify(concursoData?.banca || {})}, ${finding.data.extractionMethod || 'unknown'}
        )
        RETURNING id
      `;

      const concursoId = result[0].id;

      logger.info('Concurso finding stored', {
        concursoId,
        analysisJobId,
        orgao: concursoData?.orgao,
        totalVagas: concursoData?.vagas?.total || 0
      });

      return concursoId;
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
      let whereClause = 'WHERE 1=1';
      const params: any[] = [];

      if (filters.territories && filters.territories.length > 0) {
        whereClause += ` AND territory_id = ANY($${params.length + 1})`;
        params.push(filters.territories);
      }

      if (filters.startDate) {
        whereClause += ` AND created_at >= $${params.length + 1}`;
        params.push(filters.startDate);
      }

      if (filters.endDate) {
        whereClause += ` AND created_at <= $${params.length + 1}`;
        params.push(filters.endDate);
      }

      if (filters.minVagas !== undefined) {
        whereClause += ` AND total_vagas >= $${params.length + 1}`;
        params.push(filters.minVagas);
      }

      if (filters.orgaos && filters.orgaos.length > 0) {
        whereClause += ` AND orgao = ANY($${params.length + 1})`;
        params.push(filters.orgaos);
      }

      if (filters.documentTypes && filters.documentTypes.length > 0) {
        whereClause += ` AND document_type = ANY($${params.length + 1})`;
        params.push(filters.documentTypes);
      }

      if (filters.minConfidence !== undefined) {
        whereClause += ` AND confidence >= $${params.length + 1}`;
        params.push(filters.minConfidence);
      }

      // Get total count
      const countQuery = `SELECT COUNT(*) as total FROM concurso_findings ${whereClause}`;
      const countResult = await this.db.query(countQuery, params);
      const total = parseInt(countResult[0]?.total || '0');

      // Get results with pagination
      const dataQuery = `
        SELECT * FROM concurso_findings 
        ${whereClause}
        ORDER BY created_at DESC, total_vagas DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `;
      params.push(limit, offset);

      const result = await this.db.query(dataQuery, params);
      const concursos = result.map(row => this.mapToConcursoRecord(row));

      return {
        concursos,
        total
      };
    } catch (error) {
      logger.error('Failed to search concursos', { filters, error });
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
      const result = await this.db.queryTemplate`
        SELECT * FROM concurso_findings 
        WHERE territory_id = ${territoryId}
          AND created_at > NOW() - INTERVAL ${days} DAY
        ORDER BY created_at DESC, total_vagas DESC
        LIMIT ${limit}
      `;

      return result.map(row => this.mapToConcursoRecord(row));
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
   * Get recent concursos with high vacancy count
   */
  async getHighVacancyConcursos(
    minVagas: number = 10,
    days: number = 7,
    limit: number = 50
  ): Promise<ConcursoRecord[]> {
    try {
      const result = await this.db.queryTemplate`
        SELECT * FROM concurso_findings 
        WHERE total_vagas >= ${minVagas}
          AND created_at > NOW() - INTERVAL ${days} DAY
        ORDER BY total_vagas DESC, created_at DESC
        LIMIT ${limit}
      `;

      return result.map(row => this.mapToConcursoRecord(row));
    } catch (error) {
      logger.error('Failed to get high vacancy concursos', {
        minVagas,
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
    averageVagas: number;
    topOrgaos: Array<{ orgao: string; count: number; totalVagas: number }>;
    topTerritories: Array<{ territoryId: string; count: number; totalVagas: number }>;
    documentTypes: Array<{ type: string; count: number }>;
    vacancyDistribution: Array<{ range: string; count: number }>;
    timeline: Array<{ date: string; count: number; totalVagas: number }>;
  }> {
    try {
      const [
        generalStats,
        orgaoStats,
        territoryStats,
        documentTypeStats,
        vacancyStats,
        timelineStats
      ] = await Promise.all([
        // General statistics
        this.db.queryTemplate`
          SELECT 
            COUNT(*) as total_concursos,
            SUM(total_vagas) as total_vagas,
            AVG(total_vagas) as average_vagas
          FROM concurso_findings 
          WHERE created_at > NOW() - INTERVAL ${days} DAY
        `,

        // Top organizations
        this.db.queryTemplate`
          SELECT 
            orgao, 
            COUNT(*) as count,
            SUM(total_vagas) as total_vagas
          FROM concurso_findings 
          WHERE created_at > NOW() - INTERVAL ${days} DAY
            AND orgao IS NOT NULL
          GROUP BY orgao
          ORDER BY count DESC, total_vagas DESC
          LIMIT 20
        `,

        // Top territories
        this.db.queryTemplate`
          SELECT 
            territory_id, 
            COUNT(*) as count,
            SUM(total_vagas) as total_vagas
          FROM concurso_findings 
          WHERE created_at > NOW() - INTERVAL ${days} DAY
          GROUP BY territory_id
          ORDER BY count DESC, total_vagas DESC
          LIMIT 20
        `,

        // Document types
        this.db.queryTemplate`
          SELECT 
            document_type as type, 
            COUNT(*) as count
          FROM concurso_findings 
          WHERE created_at > NOW() - INTERVAL ${days} DAY
            AND document_type IS NOT NULL
          GROUP BY document_type
          ORDER BY count DESC
        `,

        // Vacancy distribution
        this.db.queryTemplate`
          SELECT 
            CASE 
              WHEN total_vagas = 0 THEN '0'
              WHEN total_vagas <= 5 THEN '1-5'
              WHEN total_vagas <= 20 THEN '6-20'
              WHEN total_vagas <= 50 THEN '21-50'
              WHEN total_vagas <= 100 THEN '51-100'
              ELSE '100+'
            END as range,
            COUNT(*) as count
          FROM concurso_findings 
          WHERE created_at > NOW() - INTERVAL ${days} DAY
          GROUP BY range
          ORDER BY 
            CASE range
              WHEN '0' THEN 0
              WHEN '1-5' THEN 1
              WHEN '6-20' THEN 2
              WHEN '21-50' THEN 3
              WHEN '51-100' THEN 4
              ELSE 5
            END
        `,

        // Timeline (daily breakdown)
        this.db.queryTemplate`
          SELECT 
            created_at::date as date,
            COUNT(*) as count,
            SUM(total_vagas) as total_vagas
          FROM concurso_findings 
          WHERE created_at > NOW() - INTERVAL ${days} DAY
          GROUP BY created_at::date
          ORDER BY date DESC
        `
      ]);

      const general = generalStats[0] || {};

      return {
        totalConcursos: parseInt(general.total_concursos || '0'),
        totalVagas: parseInt(general.total_vagas || '0'),
        averageVagas: Math.round(general.average_vagas || 0),
        topOrgaos: orgaoStats.map(row => ({
          orgao: row.orgao,
          count: parseInt(row.count),
          totalVagas: parseInt(row.total_vagas)
        })),
        topTerritories: territoryStats.map(row => ({
          territoryId: row.territory_id,
          count: parseInt(row.count),
          totalVagas: parseInt(row.total_vagas)
        })),
        documentTypes: documentTypeStats.map(row => ({
          type: row.type,
          count: parseInt(row.count)
        })),
        vacancyDistribution: vacancyStats.map(row => ({
          range: row.range,
          count: parseInt(row.count)
        })),
        timeline: timelineStats.map(row => ({
          date: row.date,
          count: parseInt(row.count),
          totalVagas: parseInt(row.total_vagas)
        }))
      };
    } catch (error) {
      logger.error('Failed to get concurso statistics', { days, error });
      throw error;
    }
  }

  /**
   * Search concursos by text (orgao, edital, cargos)
   */
  async searchConcursosByText(
    searchText: string,
    filters: ConcursoSearchFilters = {},
    limit: number = 50
  ): Promise<ConcursoRecord[]> {
    try {
      let whereClause = `WHERE (
        orgao ILIKE $1 OR 
        edital_numero ILIKE $1 OR
        cargos::text ILIKE $1
      )`;
      const params = [`%${searchText}%`];

      // Add filters
      if (filters.territories && filters.territories.length > 0) {
        whereClause += ` AND territory_id = ANY($${params.length + 1})`;
        params.push(filters.territories);
      }

      if (filters.minVagas !== undefined) {
        whereClause += ` AND total_vagas >= $${params.length + 1}`;
        params.push(filters.minVagas);
      }

      if (filters.minConfidence !== undefined) {
        whereClause += ` AND confidence >= $${params.length + 1}`;
        params.push(filters.minConfidence);
      }

      const query = `
        SELECT * FROM concurso_findings 
        ${whereClause}
        ORDER BY confidence DESC, total_vagas DESC, created_at DESC
        LIMIT $${params.length + 1}
      `;
      params.push(limit);

      const result = await this.db.query(query, params);
      return result.map(row => this.mapToConcursoRecord(row));
    } catch (error) {
      logger.error('Failed to search concursos by text', {
        searchText,
        filters,
        error
      });
      throw error;
    }
  }

  /**
   * Get concurso by ID with full details
   */
  async getConcursoById(id: string): Promise<ConcursoRecord | null> {
    try {
      const result = await this.db.queryTemplate`
        SELECT * FROM concurso_findings WHERE id = ${id}
      `;

      if (result.length === 0) {
        return null;
      }

      return this.mapToConcursoRecord(result[0]);
    } catch (error) {
      logger.error('Failed to get concurso by ID', { id, error });
      throw error;
    }
  }

  /**
   * Get concursos by analysis job ID
   */
  async getConcursosByAnalysisJobId(analysisJobId: string): Promise<ConcursoRecord[]> {
    try {
      const result = await this.db.queryTemplate`
        SELECT * FROM concurso_findings 
        WHERE analysis_job_id = ${analysisJobId}
        ORDER BY confidence DESC, total_vagas DESC
      `;

      return result.map(row => this.mapToConcursoRecord(row));
    } catch (error) {
      logger.error('Failed to get concursos by analysis job ID', {
        analysisJobId,
        error
      });
      throw error;
    }
  }

  /**
   * Delete old concurso findings (for maintenance)
   */
  async deleteOldConcursos(olderThanDays: number = 365): Promise<{ deleted: number }> {
    try {
      const result = await this.db.queryTemplate`
        DELETE FROM concurso_findings 
        WHERE created_at < NOW() - INTERVAL ${olderThanDays} DAY
      `;

      logger.info('Deleted old concurso findings', {
        deletedCount: result.length,
        olderThanDays
      });

      return { deleted: result.length };
    } catch (error) {
      logger.error('Failed to delete old concurso findings', {
        olderThanDays,
        error
      });
      throw error;
    }
  }

  /**
   * Map database row to ConcursoRecord
   */
  private mapToConcursoRecord(row: any): ConcursoRecord {
    return {
      id: row.id,
      analysisJobId: row.analysis_job_id,
      gazetteId: row.gazette_id,
      territoryId: row.territory_id,
      documentType: row.document_type,
      confidence: parseFloat(row.confidence || '0'),
      orgao: row.orgao,
      editalNumero: row.edital_numero,
      totalVagas: parseInt(row.total_vagas || '0'),
      cargos: row.cargos || [],
      datas: row.datas || {},
      taxas: row.taxas || [],
      banca: row.banca || {},
      extractionMethod: row.extraction_method,
      createdAt: row.created_at
    };
  }
}
