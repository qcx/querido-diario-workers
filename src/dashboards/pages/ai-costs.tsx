/**
 * AI Costs dashboard page
 */

import type { LoaderFunctionArgs } from 'react-router-dom';
import { DashboardLayout } from '../layout';
import { StatCard, Card, Table, StatusBadge } from '../components';
import { formatNumber, formatRelativeTime } from '../utils/formatters';
import { getDatabase } from '../../services/database';
import { AICostDashboard } from '../../services/dashboard';
import { useLoaderData } from '../loader-context';
import { CostTracker } from '../../services/cost-tracker';

interface AICostData {
  metrics: {
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
  };
  trends: Array<{
    date: string;
    cost: number;
    tokenCount: number;
    analysisCount: number;
  }>;
}

export async function loader({ context }: LoaderFunctionArgs) {
  const db = getDatabase(context.env as any);
  const dashboard = new AICostDashboard(db);
  
  const metrics = await dashboard.getMetrics();
  const trends = await dashboard.getCostTrends(30); // Last 30 days
  
  return { metrics, trends };
}

export function AICostsPage() {
  const { metrics, trends } = useLoaderData<AICostData>();

  const avgCostPerToken = metrics.monthly.totalTokens > 0 
    ? (metrics.monthly.totalCost / metrics.monthly.totalTokens) * 1000 
    : 0;

  return (
    <DashboardLayout currentPath="/dashboard/ai-costs">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">AI Costs</h2>
          <p className="text-gray-600 mt-1">Monitor AI usage costs across all services</p>
        </div>

        {/* Cost Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Today's Cost"
            value={CostTracker.formatCost(metrics.daily.totalCost)}
            subtitle={`${metrics.daily.analysisCount} analyses`}
          />
          <StatCard
            title="Weekly Cost"
            value={CostTracker.formatCost(metrics.weekly.totalCost)}
            subtitle={`${formatNumber(metrics.weekly.totalTokens)} tokens`}
          />
          <StatCard
            title="Monthly Cost"
            value={CostTracker.formatCost(metrics.monthly.totalCost)}
            subtitle={`Avg ${CostTracker.formatCost(metrics.monthly.averageCostPerAnalysis)}/analysis`}
          />
          <StatCard
            title="Cost per 1K Tokens"
            value={CostTracker.formatCost(avgCostPerToken)}
            subtitle="Average this month"
          />
        </div>

        {/* Cost Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* By Provider */}
          <Card title="Cost by Provider (Monthly)">
            <div className="space-y-3">
              {Object.entries(metrics.monthly.byProvider).map(([provider, cost]) => (
                <div key={provider} className="flex items-center justify-between">
                  <div className="flex items-center">
                    <span className="text-sm font-medium text-gray-700 capitalize">
                      {provider}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-gray-900">
                      {CostTracker.formatCost(cost)}
                    </span>
                    <span className="text-xs text-gray-500 ml-2">
                      ({((cost / metrics.monthly.totalCost) * 100).toFixed(1)}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* By Operation */}
          <Card title="Cost by Operation (Monthly)">
            <div className="space-y-3">
              {Object.entries(metrics.monthly.byOperation).map(([operation, cost]) => (
                <div key={operation} className="flex items-center justify-between">
                  <div className="flex items-center">
                    <span className="text-sm font-medium text-gray-700">
                      {operation.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                    </span>
                  </div>
                  <div className="text-right">
                    <span className="font-semibold text-gray-900">
                      {CostTracker.formatCost(cost)}
                    </span>
                    <span className="text-xs text-gray-500 ml-2">
                      ({((cost / metrics.monthly.totalCost) * 100).toFixed(1)}%)
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Cost Trends Chart */}
        <Card title="Cost Trends (Last 30 Days)">
          <div className="h-64 relative">
            {trends.length > 0 ? (
              <CostTrendChart trends={trends} />
            ) : (
              <div className="flex items-center justify-center h-full text-gray-500">
                No trend data available
              </div>
            )}
          </div>
        </Card>

        {/* Top Territories by Cost */}
        <Card title="Top Territories by Cost (Monthly)">
          {metrics.topTerritories.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No territory data available</p>
          ) : (
            <Table
              data={metrics.topTerritories}
              columns={[
                {
                  key: 'territoryId',
                  header: 'Territory',
                  render: (row) => (
                    <div>
                      <div className="font-medium text-gray-900">
                        {row.territoryName || row.territoryId}
                      </div>
                      {row.territoryName && (
                        <div className="text-xs text-gray-500">{row.territoryId}</div>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'analysisCount',
                  header: 'Analyses',
                  render: (row) => formatNumber(row.analysisCount),
                },
                {
                  key: 'totalCost',
                  header: 'Total Cost',
                  render: (row) => (
                    <span className="font-semibold">{CostTracker.formatCost(row.totalCost)}</span>
                  ),
                },
                {
                  key: 'avgCostPerAnalysis',
                  header: 'Avg Cost',
                  render: (row) => CostTracker.formatCost(row.avgCostPerAnalysis),
                },
              ]}
            />
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}

/**
 * Simple cost trend chart component using inline SVG
 */
function CostTrendChart({ trends }: { trends: AICostData['trends'] }) {
  if (trends.length === 0) return null;

  // Calculate chart dimensions and scales
  const width = 800;
  const height = 240;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Find min/max values
  const maxCost = Math.max(...trends.map(t => t.cost));
  const minCost = 0;

  // Create scales
  const xScale = (index: number) => (index / (trends.length - 1)) * chartWidth;
  const yScale = (value: number) => chartHeight - ((value - minCost) / (maxCost - minCost)) * chartHeight;

  // Create path data
  const pathData = trends
    .map((point, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(point.cost)}`)
    .join(' ');

  // Create area path for gradient fill
  const areaData = pathData + ` L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full">
      {/* Gradient definition */}
      <defs>
        <linearGradient id="costGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Grid lines */}
      {[0, 0.25, 0.5, 0.75, 1].map(ratio => {
        const y = padding.top + (chartHeight * (1 - ratio));
        const value = minCost + (maxCost - minCost) * ratio;
        return (
          <g key={ratio}>
            <line
              x1={padding.left}
              y1={y}
              x2={padding.left + chartWidth}
              y2={y}
              stroke="#E5E7EB"
              strokeDasharray="2,2"
            />
            <text
              x={padding.left - 10}
              y={y + 5}
              textAnchor="end"
              className="text-xs fill-gray-600"
            >
              {CostTracker.formatCost(value)}
            </text>
          </g>
        );
      })}

      {/* Chart area */}
      <g transform={`translate(${padding.left}, ${padding.top})`}>
        {/* Area fill */}
        <path d={areaData} fill="url(#costGradient)" />
        
        {/* Line */}
        <path
          d={pathData}
          fill="none"
          stroke="#3B82F6"
          strokeWidth="2"
        />

        {/* Data points */}
        {trends.map((point, i) => (
          <circle
            key={i}
            cx={xScale(i)}
            cy={yScale(point.cost)}
            r="3"
            fill="#3B82F6"
          />
        ))}
      </g>

      {/* X-axis labels */}
      {trends.filter((_, i) => i % Math.ceil(trends.length / 6) === 0).map((point, i, filtered) => {
        const index = trends.indexOf(point);
        return (
          <text
            key={index}
            x={padding.left + xScale(index)}
            y={height - 10}
            textAnchor="middle"
            className="text-xs fill-gray-600"
          >
            {new Date(point.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </text>
        );
      })}
    </svg>
  );
}
