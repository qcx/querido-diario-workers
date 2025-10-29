/**
 * Gazettes dashboard page
 */

import type { LoaderFunctionArgs } from 'react-router-dom';
import { DashboardLayout } from '../layout';
import { Card, Table, StatusBadge } from '../components';
import { formatDateOnly, formatRelativeTime } from '../utils/formatters';
import { getGazettes, type GazetteWithDetails } from '../services/dashboard-data';
import { getDatabase } from '../../services/database';
import { useLoaderData } from '../loader-context';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = getDatabase(context.env as any);
  const gazettes = await getGazettes(db, { limit: 100 });
  
  // Group by status
  const byStatus = {
    pending: gazettes.filter(g => g.status === 'pending').length,
    uploaded: gazettes.filter(g => g.status === 'uploaded').length,
    ocr_processing: gazettes.filter(g => g.status === 'ocr_processing').length,
    ocr_success: gazettes.filter(g => g.status === 'ocr_success').length,
    ocr_failure: gazettes.filter(g => g.status === 'ocr_failure').length,
  };

  return { gazettes, byStatus };
}

export function GazettesPage() {
  const { gazettes, byStatus } = useLoaderData<{
    gazettes: GazetteWithDetails[];
    byStatus: Record<string, number>;
  }>();

  return (
    <DashboardLayout currentPath="/dashboard/gazettes">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Gazettes</h2>
          <p className="text-gray-600 mt-1">Registry of collected gazette documents</p>
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
          <Table
            data={gazettes}
            columns={[
              {
                key: 'id',
                header: 'ID',
                render: (row) => (
                  <span className="font-mono text-xs">{row.id.slice(0, 8)}</span>
                ),
              },
              {
                key: 'publicationDate',
                header: 'Publication Date',
                render: (row) => (
                  <span className="text-sm">{formatDateOnly(row.publicationDate)}</span>
                ),
              },
              {
                key: 'editionNumber',
                header: 'Edition',
                render: (row) => (
                  <span className="text-sm">{row.editionNumber || '-'}</span>
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
                key: 'hasOcr',
                header: 'OCR',
                render: (row) => (
                  row.hasOcr ? (
                    <span className="text-green-600">✓</span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )
                ),
              },
              {
                key: 'hasAnalysis',
                header: 'Analysis',
                render: (row) => (
                  row.hasAnalysis ? (
                    <span className="text-green-600">✓</span>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )
                ),
              },
              {
                key: 'pdfUrl',
                header: 'PDF',
                render: (row) => (
                  <a
                    href={row.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-sm"
                  >
                    View
                  </a>
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
            ]}
            emptyMessage="No gazettes found"
          />
        </Card>
      </div>
    </DashboardLayout>
  );
}

