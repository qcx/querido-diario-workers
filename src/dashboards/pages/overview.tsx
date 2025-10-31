/**
 * Overview dashboard page
 */

import type { LoaderFunctionArgs } from 'react-router-dom';
import { DashboardLayout } from '../layout';
import { StatCard, Card, Table, StatusBadge } from '../components';
import { formatRelativeTime, formatNumber } from '../utils/formatters';
import { getOverviewStats, type OverviewStats, getAnalysisPipelineStats } from '../services/dashboard-data';
import { getDatabase } from '../../services/database';
import { useLoaderData } from '../loader-context';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = getDatabase(context.env as any);
  const stats = await getOverviewStats(db);
  const pipelineStats = await getAnalysisPipelineStats(db);
  return { stats, pipelineStats };
}

export function OverviewPage() {
  const { stats, pipelineStats } = useLoaderData<{ 
    stats: OverviewStats;
    pipelineStats: any;
  }>();

  const successRate =
    stats.ocrJobsSuccess + stats.ocrJobsFailed > 0
      ? ((stats.ocrJobsSuccess / (stats.ocrJobsSuccess + stats.ocrJobsFailed)) * 100).toFixed(1)
      : '0';

  return (
    <DashboardLayout currentPath="/dashboard">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
          <p className="text-gray-600 mt-1">System health and recent activity</p>
        </div>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Total Gazettes"
            value={formatNumber(stats.totalGazettes)}
            subtitle="In registry"
          />
          <StatCard
            title="Pipeline Success"
            value={`${pipelineStats.pipelineSuccessRate}%`}
            subtitle={`${formatNumber(pipelineStats.gazettesWithAnalysis)} analyzed`}
          />
          <StatCard
            title="Unresolved Errors"
            value={stats.unresolvedErrors}
            subtitle={`of ${stats.totalErrors} total`}
          />
          <StatCard
            title="OCR Success Rate"
            value={`${successRate}%`}
            subtitle={`${stats.ocrJobsSuccess} successful`}
          />
        </div>

        {/* Pipeline & Processing Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <Card title="Text Processing Efficiency">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Avg OCR Text:</span>
                <span className="font-semibold text-gray-900">
                  {(pipelineStats.avgOcrTextLength / 1000).toFixed(0)}K chars
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Avg Analyzed:</span>
                <span className="font-semibold text-gray-900">
                  {(pipelineStats.avgAnalyzedTextLength / 1000).toFixed(0)}K chars
                </span>
              </div>
              {pipelineStats.avgReductionPercentage > 0 && (
                <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                  <span className="text-sm text-gray-600">Avg Reduction:</span>
                  <span className="font-semibold text-green-600">
                    -{pipelineStats.avgReductionPercentage}%
                  </span>
                </div>
              )}
            </div>
          </Card>

          <Card title="Analysis Quality">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Total Findings:</span>
                <span className="font-semibold text-blue-600">
                  {formatNumber(stats.totalConcursos)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Avg High Conf.:</span>
                <span className="font-semibold text-green-600">
                  {pipelineStats.avgHighConfidenceFindings.toFixed(1)}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-200">
                Per gazette analysis
              </div>
            </div>
          </Card>

          <Card title="Processing Performance">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Avg OCR Time:</span>
                <span className="font-semibold text-gray-900">
                  {(pipelineStats.avgOcrProcessingTime / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Avg Analysis:</span>
                <span className="font-semibold text-gray-900">
                  {(pipelineStats.avgAnalysisProcessingTime / 1000).toFixed(1)}s
                </span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-gray-200">
                <span className="text-sm text-gray-600">Total Avg:</span>
                <span className="font-semibold text-blue-600">
                  {((pipelineStats.avgOcrProcessingTime + pipelineStats.avgAnalysisProcessingTime) / 1000).toFixed(1)}s
                </span>
              </div>
            </div>
          </Card>

          <Card title="Gazette Types">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">City Gazettes:</span>
                <span className="font-semibold text-blue-600">
                  {formatNumber(pipelineStats.cityGazetteCount)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">State Gazettes:</span>
                <span className="font-semibold text-purple-600">
                  {formatNumber(pipelineStats.stateGazetteCount)}
                </span>
              </div>
              <div className="text-xs text-gray-500 mt-2 pt-2 border-t border-gray-200">
                {pipelineStats.stateGazetteCount > 0 && 
                  `State gazettes filtered to relevant cities`
                }
              </div>
            </div>
          </Card>
        </div>

        {/* Pipeline Status */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card title="OCR Status">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Pending</span>
                <span className="font-semibold text-yellow-600">
                  {formatNumber(stats.ocrJobsPending)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Success</span>
                <span className="font-semibold text-green-600">
                  {formatNumber(stats.ocrJobsSuccess)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Failed</span>
                <span className="font-semibold text-red-600">
                  {formatNumber(stats.ocrJobsFailed)}
                </span>
              </div>
            </div>
          </Card>

          <Card title="Webhook Status">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Pending</span>
                <span className="font-semibold text-yellow-600">
                  {formatNumber(stats.webhooksPending)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Sent</span>
                <span className="font-semibold text-green-600">
                  {formatNumber(stats.webhooksSent)}
                </span>
              </div>
            </div>
          </Card>

          <Card title="Concursos">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-600">Total Findings</span>
                <span className="font-semibold text-blue-600">
                  {formatNumber(stats.totalConcursos)}
                </span>
              </div>
            </div>
          </Card>
        </div>

        {/* Recent Activity */}
        <Card title="Recent Activity">
          {stats.recentActivity.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No recent activity</p>
          ) : (
            <Table
              data={stats.recentActivity}
              columns={[
                {
                  key: 'type',
                  header: 'Type',
                  render: (row) => (
                    <StatusBadge status={row.type} />
                  ),
                },
                {
                  key: 'message',
                  header: 'Message',
                  className: 'max-w-md truncate',
                },
                {
                  key: 'timestamp',
                  header: 'Time',
                  render: (row) => formatRelativeTime(row.timestamp),
                },
              ]}
            />
          )}
        </Card>
      </div>
    </DashboardLayout>
  );
}

