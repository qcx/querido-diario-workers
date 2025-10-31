/**
 * Drizzle-based Crawl Jobs Repository
 */

import { and, eq, sql } from 'drizzle-orm';
import { DatabaseClient } from '../index';
import { schema } from '../index';
import { resolveFinalUrl } from '../../../utils/url-resolver';

interface GazetteData {
  date: string;
  editionNumber?: string;
  fileUrl: string;
  isExtraEdition: boolean;
  power:  'executive' | 'legislative' | 'executive_legislative';
  territoryId: string;
  scrapedAt: string;
  sourceText?: string;
}

type GazetteCrawlStatus = 
  | 'created'            // New gazette found, ready for OCR
  | 'processing'         // OCR is in progress (waiting)
  | 'analysis_pending'   // OCR complete, sent to analysis queue, awaiting processing
  | 'success'            // Analysis complete (final state)
  | 'failed';            // OCR failed or gazette has ocr_failure status (final state)

interface CreateGazetteCrawlInput {
  gazetteId: string;
  jobId: string;
  territoryId: string;
  spiderId: string;
  status: GazetteCrawlStatus;
  scrapedAt: string;
}

export class GazetteRegistryRepository {
  constructor(private dbClient: DatabaseClient) {}

  async findOrCreate(gazette: GazetteData): Promise<typeof schema.gazetteRegistry.$inferSelect> {
    const db = this.dbClient.getDb();
    let resolvedUrl: string;

    try {
      resolvedUrl = await resolveFinalUrl(gazette.fileUrl, {
        maxRedirects: 3,
        timeout: null,
        retries: 2
      });
    } catch (error) {
      resolvedUrl = gazette.fileUrl;
    }

    const existingGazette = await db.select().from(schema.gazetteRegistry).where(eq(schema.gazetteRegistry.pdfUrl, resolvedUrl)).limit(1);
    
    if (existingGazette.length > 0) {
      return existingGazette[0];
    }

    const newGazette = await db.insert(schema.gazetteRegistry).values({
      id: this.dbClient.generateId(),
      pdfUrl: resolvedUrl,
      publicationDate: gazette.date,
      editionNumber: gazette.editionNumber,
      isExtraEdition: gazette.isExtraEdition,
      power: gazette.power,
      createdAt: this.dbClient.getCurrentTimestamp(),
      status: 'pending',
      metadata: this.dbClient.stringifyJson({ sourceText: gazette.sourceText })
    }).onConflictDoNothing().returning();

    return newGazette[0];
  }

  async startProcessing(gazetteId: string): Promise<typeof schema.gazetteRegistry.$inferSelect> {
    const db = this.dbClient.getDb();
    const result = await db.update(schema.gazetteRegistry).set({ status: 'ocr_processing' }).where(and(
          eq(schema.gazetteRegistry.id, gazetteId),
          sql`status IN ('pending', 'uploaded', 'ocr_failure')`
        )).limit(1).returning();
    return result?.[0];
  }

  async trackUploaded(gazetteId: string): Promise<typeof schema.gazetteRegistry.$inferSelect> {
    const db = this.dbClient.getDb();
    const result = await db.update(schema.gazetteRegistry).set({ status: 'uploaded' }).where(and(
      eq(schema.gazetteRegistry.id, gazetteId),
      sql`status NOT IN ('ocr_processing', 'ocr_retrying', 'ocr_success', 'ocr_failure')`
    )).limit(1).returning();
    return result?.[0];
  }

  async findById(id: string): Promise<typeof schema.gazetteRegistry.$inferSelect> {
    const db = this.dbClient.getDb();
    const gazette = await db.select().from(schema.gazetteRegistry).where(eq(schema.gazetteRegistry.id, id)).limit(1);
    return gazette?.[0];
  }

  async updateCrawlsStatus(crawlId: string, status: GazetteCrawlStatus): Promise<void> {
    const db = this.dbClient.getDb();
    await db.update(schema.gazetteCrawls).set({ status }).where(eq(schema.gazetteCrawls.id, crawlId));
  }

  async trackGazetteCrawl(data: CreateGazetteCrawlInput, _crawlJobId: string): Promise<typeof schema.gazetteCrawls.$inferSelect> {
    const db = this.dbClient.getDb();

    const crawlRecord = await db.insert(schema.gazetteCrawls).values({
      id: this.dbClient.generateId(),
      ...data,
      createdAt: this.dbClient.getCurrentTimestamp()
    }).onConflictDoNothing().returning();

    return crawlRecord?.[0];
  }

  async updateGazetteStatus(gazetteId: string, status: string): Promise<typeof schema.gazetteRegistry.$inferSelect> {
    const db = this.dbClient.getDb();
    const result = await db.update(schema.gazetteRegistry)
      .set({ status })
      .where(eq(schema.gazetteRegistry.id, gazetteId)).limit(1).returning();

    return result?.[0];
  }

  async updateR2Key(gazetteId: string, pdfR2Key: string): Promise<void> {
    const db = this.dbClient.getDb();
    await db.update(schema.gazetteRegistry)
      .set({ pdfR2Key })
      .where(eq(schema.gazetteRegistry.id, gazetteId));
  }

  async linkAnalysisToGazetteCrawl(gazetteCrawlId: string, analysisResultId: string): Promise<void> {
    const db = this.dbClient.getDb();
    
    try {
      // Verify gazette crawl exists
      const crawl = await db.select().from(schema.gazetteCrawls)
        .where(eq(schema.gazetteCrawls.id, gazetteCrawlId))
        .limit(1);
      
      if (!crawl || crawl.length === 0) {
        throw new Error(`Gazette crawl ${gazetteCrawlId} not found`);
      }

      // Verify analysis result exists (defensive check for D1 eventual consistency)
      const analysis = await db.select({ id: schema.analysisResults.id })
        .from(schema.analysisResults)
        .where(eq(schema.analysisResults.id, analysisResultId))
        .limit(1);
      
      if (!analysis || analysis.length === 0) {
        throw new Error(`Analysis result ${analysisResultId} not found - possible D1 consistency delay`);
      }

      // Perform the update
      const result = await db.update(schema.gazetteCrawls)
        .set({ analysisResultId })
        .where(eq(schema.gazetteCrawls.id, gazetteCrawlId))
        .returning();

      if (!result || result.length === 0) {
        throw new Error('Update failed - no rows affected');
      }
    } catch (error: any) {
      // Enhanced error logging for D1 issues
      console.error('Failed to link analysis to gazette crawl', {
        gazetteCrawlId,
        analysisResultId,
        errorMessage: error?.message,
        errorCause: error?.cause,
        errorQuery: error?.query,
        errorParams: error?.params,
        errorStack: error?.stack
      });
      
      throw new Error(
        `Failed to link analysis ${analysisResultId} to gazette crawl ${gazetteCrawlId}: ${error?.message || 'Unknown error'}`,
        { cause: error }
      );
    }
  }
}