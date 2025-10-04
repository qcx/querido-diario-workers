/**
 * Trend analyzer for test history
 */

import { TestSuiteResult, TrendDataPoint } from '../types';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Analyzes trends in test results over time
 */
export class TrendAnalyzer {
  private historyFile: string;

  constructor(historyFile: string = './test-results/history.json') {
    this.historyFile = historyFile;
  }

  /**
   * Adds a test result to history
   */
  async addResult(result: TestSuiteResult): Promise<void> {
    const dataPoint: TrendDataPoint = {
      executionId: result.executionId,
      timestamp: result.completedAt,
      successRate: result.summary.successRate,
      totalTests: result.summary.totalTested,
      avgExecutionTime: result.summary.avgExecutionTime,
    };

    const history = await this.loadHistory();
    history.push(dataPoint);

    // Keep only last 100 results
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }

    await this.saveHistory(history);
  }

  /**
   * Loads test history
   */
  async loadHistory(): Promise<TrendDataPoint[]> {
    try {
      if (!fs.existsSync(this.historyFile)) {
        return [];
      }

      const content = fs.readFileSync(this.historyFile, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  /**
   * Saves test history
   */
  private async saveHistory(history: TrendDataPoint[]): Promise<void> {
    const dir = path.dirname(this.historyFile);

    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(this.historyFile, JSON.stringify(history, null, 2), 'utf-8');
  }

  /**
   * Analyzes trends
   */
  async analyzeTrends(): Promise<TrendAnalysis> {
    const history = await this.loadHistory();

    if (history.length < 2) {
      return {
        hasEnoughData: false,
        trend: 'stable',
        message: 'Not enough data for trend analysis',
      };
    }

    // Calculate average success rate for recent tests (last 10)
    const recentCount = Math.min(10, history.length);
    const recentHistory = history.slice(-recentCount);
    const recentAvgSuccessRate =
      recentHistory.reduce((sum, h) => sum + h.successRate, 0) / recentCount;

    // Calculate average success rate for older tests (10 before recent)
    const olderCount = Math.min(10, history.length - recentCount);
    if (olderCount === 0) {
      return {
        hasEnoughData: false,
        trend: 'stable',
        message: 'Not enough historical data for comparison',
      };
    }

    const olderHistory = history.slice(-(recentCount + olderCount), -recentCount);
    const olderAvgSuccessRate =
      olderHistory.reduce((sum, h) => sum + h.successRate, 0) / olderCount;

    // Determine trend
    const difference = recentAvgSuccessRate - olderAvgSuccessRate;

    let trend: 'improving' | 'degrading' | 'stable';
    let message: string;

    if (difference > 5) {
      trend = 'improving';
      message = `Success rate is improving (+${difference.toFixed(2)}%)`;
    } else if (difference < -5) {
      trend = 'degrading';
      message = `Success rate is degrading (${difference.toFixed(2)}%)`;
    } else {
      trend = 'stable';
      message = `Success rate is stable (${difference.toFixed(2)}% change)`;
    }

    return {
      hasEnoughData: true,
      trend,
      message,
      recentAvgSuccessRate,
      olderAvgSuccessRate,
      difference,
      dataPoints: history.length,
    };
  }

  /**
   * Detects anomalies in recent tests
   */
  async detectAnomalies(): Promise<Anomaly[]> {
    const history = await this.loadHistory();

    if (history.length < 5) {
      return [];
    }

    const anomalies: Anomaly[] = [];

    // Calculate average and standard deviation
    const successRates = history.map((h) => h.successRate);
    const avg =
      successRates.reduce((sum, rate) => sum + rate, 0) / successRates.length;
    const variance =
      successRates.reduce((sum, rate) => sum + Math.pow(rate - avg, 2), 0) /
      successRates.length;
    const stdDev = Math.sqrt(variance);

    // Check last 5 results for anomalies
    const recentResults = history.slice(-5);

    for (const result of recentResults) {
      const deviation = Math.abs(result.successRate - avg);

      if (deviation > stdDev * 2) {
        anomalies.push({
          executionId: result.executionId,
          timestamp: result.timestamp,
          successRate: result.successRate,
          expectedRate: avg,
          deviation,
          severity: deviation > stdDev * 3 ? 'critical' : 'warning',
          message: `Success rate (${result.successRate.toFixed(2)}%) deviates significantly from average (${avg.toFixed(2)}%)`,
        });
      }
    }

    return anomalies;
  }

  /**
   * Gets summary statistics
   */
  async getSummaryStats(): Promise<SummaryStats> {
    const history = await this.loadHistory();

    if (history.length === 0) {
      return {
        totalExecutions: 0,
        avgSuccessRate: 0,
        minSuccessRate: 0,
        maxSuccessRate: 0,
        avgExecutionTime: 0,
      };
    }

    const successRates = history.map((h) => h.successRate);
    const executionTimes = history.map((h) => h.avgExecutionTime);

    return {
      totalExecutions: history.length,
      avgSuccessRate:
        successRates.reduce((sum, rate) => sum + rate, 0) / successRates.length,
      minSuccessRate: Math.min(...successRates),
      maxSuccessRate: Math.max(...successRates),
      avgExecutionTime:
        executionTimes.reduce((sum, time) => sum + time, 0) / executionTimes.length,
    };
  }
}

/**
 * Trend analysis result
 */
export interface TrendAnalysis {
  hasEnoughData: boolean;
  trend: 'improving' | 'degrading' | 'stable';
  message: string;
  recentAvgSuccessRate?: number;
  olderAvgSuccessRate?: number;
  difference?: number;
  dataPoints?: number;
}

/**
 * Anomaly detection result
 */
export interface Anomaly {
  executionId: string;
  timestamp: string;
  successRate: number;
  expectedRate: number;
  deviation: number;
  severity: 'warning' | 'critical';
  message: string;
}

/**
 * Summary statistics
 */
export interface SummaryStats {
  totalExecutions: number;
  avgSuccessRate: number;
  minSuccessRate: number;
  maxSuccessRate: number;
  avgExecutionTime: number;
}
