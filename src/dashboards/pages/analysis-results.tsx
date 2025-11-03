/**
 * Analysis Results dashboard page
 */

import type { LoaderFunctionArgs } from 'react-router-dom';
import { DashboardLayout } from '../layout';
import { Card, Table, StatusBadge, PipelineStatusIndicator } from '../components';
import { formatDateOnly, formatRelativeTime, formatNumber } from '../utils/formatters';
import { getAnalysisResults, type AnalysisResultWithMetrics } from '../services/dashboard-data';
import { getDatabase } from '../../services/database';
import { useLoaderData } from '../loader-context';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = getDatabase(context.env as any);
  const results = await getAnalysisResults(db, { limit: 100 });
  
  // Calculate summary stats
  const totalFindings = results.reduce((sum, r) => sum + r.totalFindings, 0);
  const highConfidenceFindings = results.reduce((sum, r) => sum + r.highConfidenceFindings, 0);
  const filteredCount = results.filter((r) => r.filtered).length;
  const avgReduction = filteredCount > 0
    ? Math.round(
        results
          .filter((r) => r.reductionPercentage !== null)
          .reduce((sum, r) => sum + (r.reductionPercentage || 0), 0) / filteredCount
      )
    : 0;

  return { results, totalFindings, highConfidenceFindings, filteredCount, avgReduction };
}

function formatTextLength(length: number | null): string {
  if (length === null) return '-';
  if (length < 1000) return `${length} chars`;
  if (length < 1000000) return `${(length / 1000).toFixed(1)}K`;
  return `${(length / 1000000).toFixed(1)}M`;
}

export function AnalysisResultsPage() {
  const { results, totalFindings, highConfidenceFindings, filteredCount, avgReduction } =
    useLoaderData<{
      results: AnalysisResultWithMetrics[];
      totalFindings: number;
      highConfidenceFindings: number;
      filteredCount: number;
      avgReduction: number;
    }>();

  return (
    <DashboardLayout currentPath="/dashboard/analysis-results">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Analysis Results</h2>
          <p className="text-gray-600 mt-1">
            Gazette analysis results with text processing metrics
          </p>
        </div>

        {/* Summary Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-1">Total Analyses</p>
              <p className="text-2xl font-semibold text-gray-900">{results.length}</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-1">Total Findings</p>
              <p className="text-2xl font-semibold text-blue-600">{formatNumber(totalFindings)}</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-1">High Confidence</p>
              <p className="text-2xl font-semibold text-green-600">
                {formatNumber(highConfidenceFindings)}
              </p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-1">Filtered Gazettes</p>
              <p className="text-2xl font-semibold text-purple-600">
                {filteredCount}
                <span className="text-sm text-gray-500 ml-1">(-{avgReduction}%)</span>
              </p>
            </div>
          </Card>
        </div>

        {/* Analysis Results Table */}
        <Card title={`Analysis Results (${results.length})`}>
          <Table
            data={results}
            columns={[
              {
                key: 'jobId',
                header: 'Job ID',
                render: (row) => (
                  <span className="font-mono text-xs" title={row.jobId}>
                    {row.jobId.slice(0, 8)}
                  </span>
                ),
              },
              {
                key: 'territoryId',
                header: 'Territory',
                render: (row) => (
                  <span className="text-sm font-medium">{row.territoryId}</span>
                ),
              },
              {
                key: 'publicationDate',
                header: 'Publication',
                render: (row) => (
                  <span className="text-sm">{formatDateOnly(row.publicationDate)}</span>
                ),
              },
              {
                key: 'pipeline',
                header: 'Pipeline',
                render: (row) => {
                  const stages = [
                    {
                      name: 'crawl',
                      status:
                        row.gazetteStatus === 'uploaded' || row.gazetteStatus === 'ocr_success'
                          ? ('completed' as const)
                          : ('unknown' as const),
                    },
                    {
                      name: 'ocr',
                      status:
                        row.ocrStatus === 'success'
                          ? ('completed' as const)
                          : row.ocrStatus === 'processing'
                          ? ('in_progress' as const)
                          : row.ocrStatus === 'failure'
                          ? ('failed' as const)
                          : ('unknown' as const),
                    },
                    {
                      name: 'analysis',
                      status: 'completed' as const,
                    },
                  ];
                  return <PipelineStatusIndicator stages={stages} size="sm" />;
                },
              },
              {
                key: 'textMetrics',
                header: 'Text Metrics',
                render: (row) => (
                  <div className="text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">OCR:</span>
                      <span className="font-medium">
                        {formatTextLength(row.originalOcrTextLength)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">Analyzed:</span>
                      <span className="font-medium">
                        {formatTextLength(row.analyzedTextLength)}
                      </span>
                    </div>
                    {row.filtered && row.reductionPercentage !== null && (
                      <div className="flex items-center justify-between text-green-600">
                        <span>Reduction:</span>
                        <span className="font-semibold">-{row.reductionPercentage}%</span>
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'findings',
                header: 'Findings',
                render: (row) => (
                  <div className="text-sm space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="font-semibold text-gray-900">{row.totalFindings}</span>
                      <span className="text-gray-500">total</span>
                    </div>
                    {row.highConfidenceFindings > 0 && (
                      <div className="flex items-center space-x-2">
                        <span className="font-semibold text-green-600">
                          {row.highConfidenceFindings}
                        </span>
                        <span className="text-gray-500 text-xs">high conf.</span>
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'categories',
                header: 'Categories',
                render: (row) => (
                  <div className="flex flex-wrap gap-1">
                    {row.categories.slice(0, 2).map((cat, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-0.5 text-xs bg-blue-100 text-blue-800 rounded"
                      >
                        {cat}
                      </span>
                    ))}
                    {row.categories.length > 2 && (
                      <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded">
                        +{row.categories.length - 2}
                      </span>
                    )}
                  </div>
                ),
              },
              {
                key: 'processingTime',
                header: 'Time',
                render: (row) => (
                  <div className="text-xs space-y-1">
                    {row.processingTimeMs && (
                      <div>
                        <span className="text-gray-600">Analysis: </span>
                        <span className="font-medium">
                          {(row.processingTimeMs / 1000).toFixed(1)}s
                        </span>
                      </div>
                    )}
                    {row.ocrProcessingTimeMs && (
                      <div>
                        <span className="text-gray-600">OCR: </span>
                        <span className="font-medium">
                          {(row.ocrProcessingTimeMs / 1000).toFixed(1)}s
                        </span>
                      </div>
                    )}
                  </div>
                ),
              },
              {
                key: 'analyzedAt',
                header: 'Analyzed',
                render: (row) => (
                  <span className="text-sm text-gray-600">
                    {formatRelativeTime(row.analyzedAt)}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: '',
                render: (row) => (
                  <a
                    href={`/dashboard/gazettes/${row.gazetteId}`}
                    className="text-blue-600 hover:underline text-sm"
                  >
                    Details →
                  </a>
                ),
              },
            ]}
            emptyMessage="No analysis results found"
          />
        </Card>
      </div>
    </DashboardLayout>
  );
}

