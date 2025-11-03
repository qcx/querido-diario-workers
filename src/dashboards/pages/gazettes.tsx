/**
 * Gazettes dashboard page
 */

import type { LoaderFunctionArgs } from 'react-router-dom';
import { DashboardLayout } from '../layout';
import { Card, Table, StatusBadge, PipelineStatusIndicator } from '../components';
import { formatDateOnly, formatRelativeTime, formatNumber } from '../utils/formatters';
import { getGazettes, type GazetteWithDetails, getAnalysisPipelineStats } from '../services/dashboard-data';
import { getDatabase } from '../../services/database';
import { useLoaderData } from '../loader-context';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = getDatabase(context.env as any);
  const gazettes = await getGazettes(db, { limit: 100 });
  const pipelineStats = await getAnalysisPipelineStats(db);
  
  // Group by status
  const byStatus = {
    pending: gazettes.filter(g => g.status === 'pending').length,
    uploaded: gazettes.filter(g => g.status === 'uploaded').length,
    ocr_processing: gazettes.filter(g => g.status === 'ocr_processing').length,
    ocr_success: gazettes.filter(g => g.status === 'ocr_success').length,
    ocr_failure: gazettes.filter(g => g.status === 'ocr_failure').length,
  };

  return { gazettes, byStatus, pipelineStats };
}

export function GazettesPage() {
  const { gazettes, byStatus, pipelineStats } = useLoaderData<{
    gazettes: GazetteWithDetails[];
    byStatus: Record<string, number>;
    pipelineStats: any;
  }>();

  return (
    <DashboardLayout currentPath="/dashboard/gazettes">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Gazettes</h2>
          <p className="text-gray-600 mt-1">Registry of collected gazette documents</p>
        </div>

        {/* Pipeline Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-1">Pipeline Success</p>
              <p className="text-2xl font-semibold text-green-600">
                {pipelineStats.pipelineSuccessRate}%
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {formatNumber(pipelineStats.gazettesWithAnalysis)} analyzed
              </p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-1">Avg OCR Text</p>
              <p className="text-2xl font-semibold text-blue-600">
                {(pipelineStats.avgOcrTextLength / 1000).toFixed(0)}K
              </p>
              <p className="text-xs text-gray-500 mt-1">characters</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-1">Text Reduction</p>
              <p className="text-2xl font-semibold text-purple-600">
                {pipelineStats.avgReductionPercentage}%
              </p>
              <p className="text-xs text-gray-500 mt-1">filtered gazettes</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-1">Avg Findings</p>
              <p className="text-2xl font-semibold text-orange-600">
                {pipelineStats.avgHighConfidenceFindings.toFixed(1)}
              </p>
              <p className="text-xs text-gray-500 mt-1">high confidence</p>
            </div>
          </Card>
        </div>

        {/* Status Summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {Object.entries(byStatus).map(([status, count]) => (
            <Card key={status}>
              <div className="text-center">
                <StatusBadge status={status} className="mb-2" />
                <p className="text-2xl font-semibold text-gray-900">{count}</p>
              </div>
            </Card>
          ))}
        </div>

        {/* Gazettes Table */}
        <Card title={`Gazette Registry (${gazettes.length})`}>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ID
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Territory
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Publication
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Pipeline
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Created
                  </th>
                  <th className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {gazettes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-gray-500">
                      No gazettes found
                    </td>
                  </tr>
                ) : (
                  gazettes.map((gazette) => {
                    const pipelineStages = [
                      {
                        name: 'crawl',
                        status:
                          gazette.status === 'uploaded' || gazette.status === 'ocr_success'
                            ? ('completed' as const)
                            : ('pending' as const),
                      },
                      {
                        name: 'ocr',
                        status: gazette.hasOcr
                          ? ('completed' as const)
                          : gazette.status === 'ocr_processing'
                          ? ('in_progress' as const)
                          : gazette.status === 'ocr_failure'
                          ? ('failed' as const)
                          : ('pending' as const),
                      },
                      {
                        name: 'analysis',
                        status: gazette.hasAnalysis ? ('completed' as const) : ('pending' as const),
                      },
                    ];

                    return (
                      <tr
                        key={gazette.id}
                        className="hover:bg-gray-50 cursor-pointer transition-colors"
                        onClick={() => {
                          window.location.href = `/dashboard/gazettes/${gazette.id}`;
                        }}
                      >
                        <td className="px-3 py-4 whitespace-nowrap">
                          <span className="font-mono text-xs">{gazette.id.slice(0, 8)}</span>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <span className="text-sm font-medium">{gazette.territoryId || '-'}</span>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <div>
                            <span className="text-sm">{formatDateOnly(gazette.publicationDate)}</span>
                            {gazette.editionNumber && (
                              <span className="text-xs text-gray-500 ml-2">
                                Ed. {gazette.editionNumber}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <PipelineStatusIndicator stages={pipelineStages} size="sm" />
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <StatusBadge status={gazette.status} />
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap">
                          <span className="text-sm text-gray-600">
                            {formatRelativeTime(gazette.createdAt)}
                          </span>
                        </td>
                        <td className="px-3 py-4 whitespace-nowrap text-sm">
                          <div className="flex space-x-2">
                            <a
                              href={`/dashboard/gazettes/${gazette.id}`}
                              className="text-blue-600 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              Details
                            </a>
                            <span className="text-gray-300">|</span>
                            <a
                              href={gazette.pdfUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                              onClick={(e) => e.stopPropagation()}
                            >
                              PDF
                            </a>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
}

