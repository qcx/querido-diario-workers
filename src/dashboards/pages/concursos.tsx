/**
 * Concursos dashboard page
 */

import type { LoaderFunctionArgs } from 'react-router-dom';
import { DashboardLayout } from '../layout';
import { Card, Table, StatCard } from '../components';
import { formatDateOnly, formatRelativeTime, formatNumber } from '../utils/formatters';
import { getConcursos, type ConcursoWithDetails } from '../services/dashboard-data';
import { getDatabase } from '../../services/database';
import { useLoaderData } from '../loader-context';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = getDatabase(context.env as any);
  const concursos = await getConcursos(db, { limit: 100 });
  
  // Calculate stats
  const totalVagas = concursos.reduce((sum, c) => sum + (c.totalVagas || 0), 0);
  const withVagas = concursos.filter(c => (c.totalVagas || 0) > 0).length;
  const avgConfidence = concursos.reduce((sum, c) => sum + (c.confidence || 0), 0) / concursos.length;
  
  // Group by extraction method
  const byMethod: Record<string, number> = {};
  concursos.forEach(c => {
    const method = c.extractionMethod || 'unknown';
    byMethod[method] = (byMethod[method] || 0) + 1;
  });

  return { concursos, totalVagas, withVagas, avgConfidence, byMethod };
}

export function ConcursosPage() {
  const { concursos, totalVagas, withVagas, avgConfidence, byMethod } = useLoaderData<{
    concursos: ConcursoWithDetails[];
    totalVagas: number;
    withVagas: number;
    avgConfidence: number;
    byMethod: Record<string, number>;
  }>();

  return (
    <DashboardLayout currentPath="/dashboard/concursos">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Concursos</h2>
          <p className="text-gray-600 mt-1">Public competition findings from gazettes</p>
        </div>

        {/* Concurso Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Total Concursos"
            value={formatNumber(concursos.length)}
            subtitle="Found in gazettes"
          />
          <StatCard
            title="Total Vagas"
            value={formatNumber(totalVagas)}
            subtitle={`${withVagas} with vagas data`}
          />
          <StatCard
            title="Avg Confidence"
            value={`${avgConfidence.toFixed(1)}%`}
            subtitle="Extraction confidence"
          />
          <StatCard
            title="Extraction Methods"
            value={Object.keys(byMethod).length}
            subtitle="Different methods used"
          />
        </div>

        {/* Extraction Methods */}
        <Card title="Extraction Methods">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(byMethod).map(([method, count]) => (
              <div key={method} className="text-center p-4 bg-gray-50 rounded-lg">
                <p className="text-sm text-gray-600 mb-1">{method}</p>
                <p className="text-2xl font-semibold text-gray-900">{count}</p>
              </div>
            ))}
          </div>
        </Card>

        {/* Concursos Table */}
        <Card title={`Recent Concursos (${concursos.length})`}>
          <Table
            data={concursos}
            columns={[
              {
                key: 'id',
                header: 'ID',
                render: (row) => (
                  <span className="font-mono text-xs">{row.id.slice(0, 8)}</span>
                ),
              },
              {
                key: 'territoryId',
                header: 'Territory',
                render: (row) => (
                  <span className="font-mono text-xs">{row.territoryId}</span>
                ),
              },
              {
                key: 'orgao',
                header: 'Órgão',
                render: (row) => (
                  <span className="text-sm max-w-xs truncate block" title={row.orgao || ''}>
                    {row.orgao || '-'}
                  </span>
                ),
              },
              {
                key: 'editalNumero',
                header: 'Edital',
                render: (row) => (
                  <span className="text-sm">{row.editalNumero || '-'}</span>
                ),
              },
              {
                key: 'totalVagas',
                header: 'Vagas',
                render: (row) => (
                  <span className="text-sm font-medium">
                    {row.totalVagas ? formatNumber(row.totalVagas) : '-'}
                  </span>
                ),
              },
              {
                key: 'confidence',
                header: 'Confidence',
                render: (row) => {
                  if (!row.confidence) return <span className="text-gray-400">-</span>;
                  const conf = row.confidence * 100;
                  return (
                    <span className={`text-sm ${conf >= 80 ? 'text-green-600' : conf >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                      {conf.toFixed(0)}%
                    </span>
                  );
                },
              },
              {
                key: 'documentType',
                header: 'Type',
                render: (row) => (
                  <span className="text-xs">{row.documentType || '-'}</span>
                ),
              },
              {
                key: 'gazettePublicationDate',
                header: 'Gazette Date',
                render: (row) => (
                  <span className="text-sm text-gray-600">
                    {row.gazettePublicationDate ? formatDateOnly(row.gazettePublicationDate) : '-'}
                  </span>
                ),
              },
              {
                key: 'createdAt',
                header: 'Found',
                render: (row) => (
                  <span className="text-sm text-gray-600">
                    {formatRelativeTime(row.createdAt)}
                  </span>
                ),
              },
            ]}
            emptyMessage="No concursos found"
          />
        </Card>
      </div>
    </DashboardLayout>
  );
}

