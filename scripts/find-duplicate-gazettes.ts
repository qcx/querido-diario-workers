/**
 * Find Duplicate Gazettes Script
 * 
 * This script identifies potential duplicate gazette entries in the database
 * that may have been created with different PDF URLs pointing to the same content.
 * 
 * Usage: bun run scripts/find-duplicate-gazettes.ts
 */

import { DrizzleDatabaseClient } from '../src/services/database/drizzle-client';
import { eq, sql } from 'drizzle-orm';
import { schema } from '../src/services/database';
import { resolveFinalUrlsBatch } from '../src/utils/url-resolver';
import { logger } from '../src/utils/logger';

interface DuplicateCluster {
  territoryId: string;
  publicationDate: string;
  editionNumber: string | null;
  gazettes: Array<{
    id: string;
    pdfUrl: string;
    resolvedUrl?: string;
    ocrCount: number;
    analysisCount: number;
    createdAt: string;
  }>;
}

async function findDuplicateGazettes() {
  logger.info('Starting duplicate gazette detection...');
  
  const dbClient = new DrizzleDatabaseClient({
    DB: process.env.DB as any, // Replace with actual D1 binding
  });
  
  const db = dbClient.getDb();
  
  try {
    // Step 1: Find gazette groups with multiple entries (same territory, date, edition)
    logger.info('Querying gazette registry for potential duplicates...');
    
    const allGazettes = await db.select({
      id: schema.gazetteRegistry.id,
      publicationDate: schema.gazetteRegistry.publicationDate,
      editionNumber: schema.gazetteRegistry.editionNumber,
      pdfUrl: schema.gazetteRegistry.pdfUrl,
      createdAt: schema.gazetteRegistry.createdAt,
    })
    .from(schema.gazetteRegistry)
    .orderBy(schema.gazetteRegistry.publicationDate, schema.gazetteRegistry.createdAt);
    
    logger.info(`Found ${allGazettes.length} total gazettes in registry`);
    
    // Step 2: Group gazettes by publication date and edition number
    // We need to join with gazette_crawls to get territoryId
    const gazetteWithTerritory = await db.select({
      gazetteId: schema.gazetteRegistry.id,
      territoryId: schema.gazetteCrawls.territoryId,
      publicationDate: schema.gazetteRegistry.publicationDate,
      editionNumber: schema.gazetteRegistry.editionNumber,
      pdfUrl: schema.gazetteRegistry.pdfUrl,
      createdAt: schema.gazetteRegistry.createdAt,
    })
    .from(schema.gazetteRegistry)
    .innerJoin(schema.gazetteCrawls, eq(schema.gazetteCrawls.gazetteId, schema.gazetteRegistry.id))
    .orderBy(schema.gazetteRegistry.publicationDate);
    
    logger.info(`Found ${gazetteWithTerritory.length} gazette-territory associations`);
    
    // Group by territoryId + publicationDate + editionNumber
    const groups = new Map<string, typeof gazetteWithTerritory>();
    
    for (const gazette of gazetteWithTerritory) {
      const key = `${gazette.territoryId}|${gazette.publicationDate}|${gazette.editionNumber || 'NULL'}`;
      if (!groups.has(key)) {
        groups.set(key, []);
      }
      groups.get(key)!.push(gazette);
    }
    
    // Filter to groups with multiple gazettes (potential duplicates)
    const potentialDuplicates = Array.from(groups.entries())
      .filter(([_, gazettes]) => gazettes.length > 1)
      .map(([key, gazettes]) => {
        const [territoryId, publicationDate, editionNumber] = key.split('|');
        return {
          territoryId,
          publicationDate,
          editionNumber: editionNumber === 'NULL' ? null : editionNumber,
          gazettes,
        };
      });
    
    logger.info(`Found ${potentialDuplicates.length} potential duplicate clusters`);
    
    if (potentialDuplicates.length === 0) {
      logger.info('No duplicate clusters found!');
      return;
    }
    
    // Step 3: For each cluster, resolve URLs and get associated data
    const duplicateClusters: DuplicateCluster[] = [];
    
    for (const cluster of potentialDuplicates) {
      logger.info(`Processing cluster: ${cluster.territoryId} | ${cluster.publicationDate} | Edition ${cluster.editionNumber || 'N/A'}`);
      
      const urls = cluster.gazettes.map(g => g.pdfUrl);
      const resolvedUrls = await resolveFinalUrlsBatch(urls, {
        maxRedirects: 10,
        timeout: 10000,
        retries: 1,
      });
      
      const clusterGazettes = await Promise.all(
        cluster.gazettes.map(async (gazette) => {
          // Count OCR results
          const ocrResults = await db.select({ count: sql<number>`count(*)` })
            .from(schema.ocrResults)
            .where(eq(schema.ocrResults.documentId, gazette.gazetteId));
          
          // Count analysis results
          const analysisResults = await db.select({ count: sql<number>`count(*)` })
            .from(schema.analysisResults)
            .where(eq(schema.analysisResults.gazetteId, gazette.gazetteId));
          
          return {
            id: gazette.gazetteId,
            pdfUrl: gazette.pdfUrl,
            resolvedUrl: resolvedUrls.get(gazette.pdfUrl),
            ocrCount: Number(ocrResults[0]?.count || 0),
            analysisCount: Number(analysisResults[0]?.count || 0),
            createdAt: gazette.createdAt,
          };
        })
      );
      
      duplicateClusters.push({
        territoryId: cluster.territoryId,
        publicationDate: cluster.publicationDate,
        editionNumber: cluster.editionNumber,
        gazettes: clusterGazettes,
      });
    }
    
    // Step 4: Generate reports
    logger.info('\n========== DUPLICATE GAZETTE REPORT ==========\n');
    
    let totalDuplicates = 0;
    let sameResolvedUrl = 0;
    
    for (const cluster of duplicateClusters) {
      totalDuplicates += cluster.gazettes.length - 1; // -1 because one is the original
      
      // Check if resolved URLs are the same
      const resolvedUrls = cluster.gazettes
        .map(g => g.resolvedUrl)
        .filter(url => url !== undefined);
      const uniqueResolved = new Set(resolvedUrls);
      
      if (uniqueResolved.size === 1 && uniqueResolved.size < cluster.gazettes.length) {
        sameResolvedUrl++;
      }
      
      logger.info(`Cluster: ${cluster.territoryId} | ${cluster.publicationDate} | Edition ${cluster.editionNumber || 'N/A'}`);
      logger.info(`  Duplicate count: ${cluster.gazettes.length} entries`);
      
      for (const gazette of cluster.gazettes) {
        logger.info(`  - Gazette ID: ${gazette.id}`);
        logger.info(`    Original URL: ${gazette.pdfUrl.substring(0, 80)}...`);
        if (gazette.resolvedUrl) {
          logger.info(`    Resolved URL: ${gazette.resolvedUrl.substring(0, 80)}...`);
        }
        logger.info(`    OCR results: ${gazette.ocrCount}, Analysis results: ${gazette.analysisCount}`);
        logger.info(`    Created: ${gazette.createdAt}`);
      }
      logger.info('');
    }
    
    logger.info('========== SUMMARY ==========');
    logger.info(`Total duplicate clusters: ${duplicateClusters.length}`);
    logger.info(`Total duplicate entries: ${totalDuplicates}`);
    logger.info(`Clusters with same resolved URL: ${sameResolvedUrl}`);
    logger.info(`\nRecommendation: Review these clusters and consider merging duplicates that resolve to the same URL.`);
    
    // Write JSON report
    const report = {
      generatedAt: new Date().toISOString(),
      totalClusters: duplicateClusters.length,
      totalDuplicates,
      clusters: duplicateClusters,
    };
    
    await Bun.write('duplicate-gazettes-report.json', JSON.stringify(report, null, 2));
    logger.info('\nDetailed report saved to: duplicate-gazettes-report.json');
    
  } catch (error) {
    logger.error('Error finding duplicates', { error });
    throw error;
  }
}

// Run the script
if (import.meta.main) {
  findDuplicateGazettes()
    .then(() => {
      logger.info('Duplicate detection completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Duplicate detection failed', { error });
      process.exit(1);
    });
}

