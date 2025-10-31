/**
 * AI Cost Dashboard Service
 * Aggregates and provides cost metrics for dashboard display
 */

import { DrizzleDatabaseClient, schema } from '../database';
import { CostTracker, AIUsage } from '../cost-tracker';
import { logger } from '../../utils';
import { eq, gte, and, sql } from 'drizzle-orm';

export interface AICostMetrics {
  daily: {
    date: string;
    totalCost: number;
    byProvider: Record<string, number>;
    byOperation: Record<string, number>;
    totalTokens: number;
    analysisCount: number;
  };
  weekly: {
    startDate: string;
    endDate: string;
    totalCost: number;
    byProvider: Record<string, number>;
    byOperation: Record<string, number>;
    totalTokens: number;
    analysisCount: number;
  };
  monthly: {
    month: string;
    totalCost: number;
    byProvider: Record<string, number>;
    byOperation: Record<string, number>;
    totalTokens: number;
    analysisCount: number;
    averageCostPerAnalysis: number;
  };
  topTerritories: Array<{
    territoryId: string;
    territoryName?: string;
    totalCost: number;
    analysisCount: number;
    avgCostPerAnalysis: number;
  }>;
}

export class AICostDashboard {
  constructor(private dbClient: DrizzleDatabaseClient) {}

  /**
   * Get comprehensive cost metrics for dashboard display
   */
  async getMetrics(): Promise<AICostMetrics> {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(todayStart);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Start of week (Sunday)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [daily, weekly, monthly, topTerritories] = await Promise.all([
      this.getDailyMetrics(todayStart),
      this.getWeeklyMetrics(weekStart),
      this.getMonthlyMetrics(monthStart),
      this.getTopTerritories(monthStart),
    ]);

    return {
      daily,
      weekly,
      monthly,
      topTerritories,
    };
  }

  /**
   * Get daily cost metrics
   */
  private async getDailyMetrics(date: Date): Promise<AICostMetrics['daily']> {
    const db = this.dbClient.getDb();
    const dateStr = date.toISOString().split('T')[0];

    // Get all analyses from today
    const results = await db.select()
      .from(schema.analysisResults)
      .where(gte(schema.analysisResults.analyzedAt, dateStr))
      .orderBy(schema.analysisResults.analyzedAt);

    return this.aggregateMetrics(results, dateStr);
  }

  /**
   * Get weekly cost metrics
   */
  private async getWeeklyMetrics(weekStart: Date): Promise<AICostMetrics['weekly']> {
    const db = this.dbClient.getDb();
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    const results = await db.select()
      .from(schema.analysisResults)
      .where(gte(schema.analysisResults.analyzedAt, weekStart.toISOString().split('T')[0]))
      .orderBy(schema.analysisResults.analyzedAt);

    const metrics = this.aggregateMetrics(results);

    return {
      startDate: weekStart.toISOString().split('T')[0],
      endDate: weekEnd.toISOString().split('T')[0],
      ...metrics,
    };
  }

  /**
   * Get monthly cost metrics
   */
  private async getMonthlyMetrics(monthStart: Date): Promise<AICostMetrics['monthly']> {
    const db = this.dbClient.getDb();

    const results = await db.select()
      .from(schema.analysisResults)
      .where(gte(schema.analysisResults.analyzedAt, monthStart.toISOString().split('T')[0]))
      .orderBy(schema.analysisResults.analyzedAt);

    const metrics = this.aggregateMetrics(results);
    const avgCostPerAnalysis = metrics.analysisCount > 0 
      ? metrics.totalCost / metrics.analysisCount 
      : 0;

    return {
      month: monthStart.toISOString().substring(0, 7), // YYYY-MM
      ...metrics,
      averageCostPerAnalysis: avgCostPerAnalysis,
    };
  }

  /**
   * Get top territories by cost
   */
  private async getTopTerritories(since: Date): Promise<AICostMetrics['topTerritories']> {
    const db = this.dbClient.getDb();

    const results = await db.select({
      territoryId: schema.analysisResults.territoryId,
      count: sql<number>`COUNT(*)`,
      metadata: sql<string>`GROUP_CONCAT(${schema.analysisResults.metadata})`,
    })
      .from(schema.analysisResults)
      .where(gte(schema.analysisResults.analyzedAt, since.toISOString().split('T')[0]))
      .groupBy(schema.analysisResults.territoryId)
      .orderBy(sql`COUNT(*) DESC`)
      .limit(10);

    // Process territory costs
    const territories = results.map(row => {
      let totalCost = 0;
      let totalTokens = 0;

      // Parse metadata from concatenated JSONs
      const metadataStrings = row.metadata?.split(',') || [];
      for (const metaStr of metadataStrings) {
        try {
          const meta = JSON.parse(metaStr);
          if (meta.aiUsage?.totalCost) {
            totalCost += meta.aiUsage.totalCost;
          }
          if (meta.aiUsage?.analyzers) {
            for (const analyzer of meta.aiUsage.analyzers) {
              totalTokens += analyzer.totalTokens || 0;
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }

      return {
        territoryId: row.territoryId,
        territoryName: this.getTerritoryName(row.territoryId),
        totalCost,
        analysisCount: row.count,
        avgCostPerAnalysis: row.count > 0 ? totalCost / row.count : 0,
      };
    });

    return territories.sort((a, b) => b.totalCost - a.totalCost).slice(0, 10);
  }

  /**
   * Aggregate metrics from analysis results
   */
  private aggregateMetrics(results: any[], date?: string): Omit<AICostMetrics['daily'], 'date'> {
    let totalCost = 0;
    let totalTokens = 0;
    const byProvider: Record<string, number> = {};
    const byOperation: Record<string, number> = {};

    for (const result of results) {
      try {
        const metadata = this.dbClient.parseJson(result.metadata);
        
        if (metadata.aiUsage) {
          const usage = metadata.aiUsage;
          totalCost += usage.totalCost || 0;

          // Aggregate by analyzer/operation
          if (usage.analyzers && Array.isArray(usage.analyzers)) {
            for (const analyzer of usage.analyzers) {
              // By provider
              const provider = analyzer.provider || 'unknown';
              byProvider[provider] = (byProvider[provider] || 0) + (analyzer.totalCost || 0);

              // By operation
              const operation = analyzer.analyzer || 'unknown';
              byOperation[operation] = (byOperation[operation] || 0) + (analyzer.totalCost || 0);

              // Total tokens
              totalTokens += analyzer.totalTokens || 0;
            }
          }
        }
      } catch (error) {
        logger.warn('Failed to parse analysis metadata for cost tracking', { error });
      }
    }

    return {
      date: date || new Date().toISOString().split('T')[0],
      totalCost,
      byProvider,
      byOperation,
      totalTokens,
      analysisCount: results.length,
    };
  }

  /**
   * Get territory name from ID (placeholder - should use TerritoryService)
   */
  private getTerritoryName(territoryId: string): string | undefined {
    // This is a placeholder - in production, use TerritoryService
    // For now, just return the ID
    return undefined;
  }

  /**
   * Get cost trends over time
   */
  async getCostTrends(days: number = 30): Promise<Array<{
    date: string;
    cost: number;
    tokenCount: number;
    analysisCount: number;
  }>> {
    const db = this.dbClient.getDb();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const results = await db.select({
      date: sql<string>`DATE(${schema.analysisResults.analyzedAt})`,
      count: sql<number>`COUNT(*)`,
      metadata: sql<string>`GROUP_CONCAT(${schema.analysisResults.metadata})`,
    })
      .from(schema.analysisResults)
      .where(gte(schema.analysisResults.analyzedAt, startDate.toISOString().split('T')[0]))
      .groupBy(sql`DATE(${schema.analysisResults.analyzedAt})`)
      .orderBy(sql`DATE(${schema.analysisResults.analyzedAt})`);

    return results.map(row => {
      let cost = 0;
      let tokenCount = 0;

      const metadataStrings = row.metadata?.split(',') || [];
      for (const metaStr of metadataStrings) {
        try {
          const meta = JSON.parse(metaStr);
          if (meta.aiUsage?.totalCost) {
            cost += meta.aiUsage.totalCost;
          }
          if (meta.aiUsage?.analyzers) {
            for (const analyzer of meta.aiUsage.analyzers) {
              tokenCount += analyzer.totalTokens || 0;
            }
          }
        } catch (e) {
          // Skip invalid JSON
        }
      }

      return {
        date: row.date,
        cost,
        tokenCount,
        analysisCount: row.count,
      };
    });
  }

  /**
   * Format dashboard report for display
   */
  formatReport(metrics: AICostMetrics): string {
    const lines = [
      '# AI Cost Dashboard',
      '',
      '## Today\'s Costs',
      `- Total: ${CostTracker.formatCost(metrics.daily.totalCost)}`,
      `- Analyses: ${metrics.daily.analysisCount}`,
      `- Tokens: ${metrics.daily.totalTokens.toLocaleString()}`,
      '',
      '### By Provider:',
      ...Object.entries(metrics.daily.byProvider).map(([provider, cost]) => 
        `  - ${provider}: ${CostTracker.formatCost(cost)}`
      ),
      '',
      '## Weekly Summary',
      `- Period: ${metrics.weekly.startDate} to ${metrics.weekly.endDate}`,
      `- Total: ${CostTracker.formatCost(metrics.weekly.totalCost)}`,
      `- Analyses: ${metrics.weekly.analysisCount}`,
      '',
      '## Monthly Summary',
      `- Month: ${metrics.monthly.month}`,
      `- Total: ${CostTracker.formatCost(metrics.monthly.totalCost)}`,
      `- Analyses: ${metrics.monthly.analysisCount}`,
      `- Avg per Analysis: ${CostTracker.formatCost(metrics.monthly.averageCostPerAnalysis)}`,
      '',
      '## Top Territories by Cost',
      ...metrics.topTerritories.slice(0, 5).map((t, i) => 
        `${i + 1}. ${t.territoryName || t.territoryId}: ${CostTracker.formatCost(t.totalCost)} (${t.analysisCount} analyses)`
      ),
    ];

    return lines.join('\n');
  }
}
