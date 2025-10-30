/**
 * OCR dashboard page
 */

import type { LoaderFunctionArgs } from 'react-router-dom';
import { DashboardLayout } from '../layout';
import { Card, Table, StatusBadge, StatCard } from '../components';
import { formatDuration, formatRelativeTime, formatNumber } from '../utils/formatters';
import { getOcrJobStats, type OcrJobStats } from '../services/dashboard-data';
import { getDatabase } from '../../services/database';
import { useLoaderData } from '../loader-context';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = getDatabase(context.env as any);
  const ocrStats = await getOcrJobStats(db);
  return { ocrStats };
}

export function OcrPage() {
  const { ocrStats } = useLoaderData<{ ocrStats: OcrJobStats }>();

  const total = ocrStats.pending + ocrStats.processing + ocrStats.success + ocrStats.failure;
  const successRate = total > 0 ? ((ocrStats.success / total) * 100).toFixed(1) : '0';

  return (
    <DashboardLayout currentPath="/dashboard/ocr">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">OCR Processing</h2>
          <p className="text-gray-600 mt-1">Optical character recognition job status</p>
        </div>

        {/* OCR Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Success Rate"
            value={`${successRate}%`}
            subtitle={`${ocrStats.success} successful`}
          />
          <StatCard
            title="Avg Processing Time"
            value={formatDuration(ocrStats.avgProcessingTime)}
            subtitle="Per document"
          />
          <StatCard
            title="Avg Text Length"
            value={formatNumber(Math.round(ocrStats.avgTextLength))}
            subtitle="Characters extracted"
          />
          <StatCard
            title="Total Jobs"
            value={formatNumber(total)}
            subtitle={`${ocrStats.pending} pending`}
          />
        </div>

        {/* Status Breakdown */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-2">Pending</p>
              <p className="text-3xl font-semibold text-yellow-600">{ocrStats.pending}</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-2">Processing</p>
              <p className="text-3xl font-semibold text-blue-600">{ocrStats.processing}</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-2">Success</p>
              <p className="text-3xl font-semibold text-green-600">{ocrStats.success}</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-2">Failed</p>
              <p className="text-3xl font-semibold text-red-600">{ocrStats.failure}</p>
            </div>
          </Card>
        </div>

        {/* Recent OCR Jobs */}
        <Card title={`Recent OCR Jobs (${ocrStats.recentJobs.length})`}>
          <Table
            data={ocrStats.recentJobs}
            columns={[
              {
                key: 'id',
                header: 'Job ID',
                render: (row) => (
                  <span className="font-mono text-xs">{row.id.slice(0, 8)}</span>
                ),
              },
              {
                key: 'documentId',
                header: 'Document',
                render: (row) => (
                  <span className="font-mono text-xs">{row.documentId.slice(0, 12)}</span>
                ),
              },
              {
                key: 'status',
                header: 'Status',
                render: (row) => (
                  <StatusBadge status={row.status} />
                ),
              },
              {
                key: 'pagesProcessed',
                header: 'Pages',
                render: (row) => (
                  <span className="text-sm">{row.pagesProcessed ?? '-'}</span>
                ),
              },
              {
                key: 'textLength',
                header: 'Text Length',
                render: (row) => (
                  <span className="text-sm">
                    {row.textLength ? formatNumber(row.textLength) : '-'}
                  </span>
                ),
              },
              {
                key: 'processingTimeMs',
                header: 'Duration',
                render: (row) => (
                  <span className="text-sm">
                    {row.processingTimeMs ? formatDuration(row.processingTimeMs) : '-'}
                  </span>
                ),
              },
              {
                key: 'createdAt',
                header: 'Created',
                render: (row) => (
                  <span className="text-sm text-gray-600">
                    {formatRelativeTime(row.createdAt)}
                  </span>
                ),
              },
              {
                key: 'completedAt',
                header: 'Completed',
                render: (row) => (
                  <span className="text-sm text-gray-600">
                    {row.completedAt ? formatRelativeTime(row.completedAt) : '-'}
                  </span>
                ),
              },
            ]}
            emptyMessage="No OCR jobs found"
          />
        </Card>
      </div>
    </DashboardLayout>
  );
}

