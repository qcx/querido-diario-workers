/**
 * Telemetry dashboard page
 */

import type { LoaderFunctionArgs } from 'react-router-dom';
import { DashboardLayout } from '../layout';
import { Card, Table, StatusBadge } from '../components';
import { formatDuration, formatRelativeTime, formatPercentage } from '../utils/formatters';
import { getTelemetryStats, type TelemetryStats } from '../services/dashboard-data';
import { getDatabase } from '../../services/database';
import { useLoaderData } from '../loader-context';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = getDatabase(context.env as any);
  const telemetry = await getTelemetryStats(db);
  return { telemetry };
}

export function TelemetryPage() {
  const { telemetry } = useLoaderData<{ telemetry: TelemetryStats }>();

  return (
    <DashboardLayout currentPath="/dashboard/telemetry">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Telemetry</h2>
          <p className="text-gray-600 mt-1">Performance metrics and execution statistics</p>
        </div>

        {/* By Spider Type */}
        <Card title="Performance by Spider Type">
          <Table
            data={telemetry.bySpiderType}
            columns={[
              {
                key: 'spiderType',
                header: 'Spider Type',
                render: (row) => (
                  <span className="font-medium">{row.spiderType}</span>
                ),
              },
              {
                key: 'totalRuns',
                header: 'Total Runs',
                render: (row) => (
                  <span className="text-sm">{row.totalRuns}</span>
                ),
              },
              {
                key: 'successfulRuns',
                header: 'Success',
                render: (row) => (
                  <span className="text-green-600 font-medium">{row.successfulRuns}</span>
                ),
              },
              {
                key: 'failedRuns',
                header: 'Failed',
                render: (row) => (
                  <span className="text-red-600 font-medium">{row.failedRuns}</span>
                ),
              },
              {
                key: 'successRate',
                header: 'Success Rate',
                render: (row) => {
                  const rate = row.totalRuns > 0 
                    ? (row.successfulRuns / row.totalRuns) * 100 
                    : 0;
                  return (
                    <span className={rate >= 90 ? 'text-green-600' : rate >= 70 ? 'text-yellow-600' : 'text-red-600'}>
                      {formatPercentage(rate)}
                    </span>
                  );
                },
              },
              {
                key: 'avgExecutionTime',
                header: 'Avg Time',
                render: (row) => (
                  <span className="text-sm">{formatDuration(row.avgExecutionTime)}</span>
                ),
              },
            ]}
            emptyMessage="No telemetry data available"
          />
        </Card>

        {/* By Step */}
        <Card title="Pipeline Steps">
          <Table
            data={telemetry.byStep}
            columns={[
              {
                key: 'step',
                header: 'Step',
                render: (row) => (
                  <span className="font-medium">{row.step}</span>
                ),
              },
              {
                key: 'totalRuns',
                header: 'Total',
                render: (row) => (
                  <span className="text-sm">{row.totalRuns}</span>
                ),
              },
              {
                key: 'completed',
                header: 'Completed',
                render: (row) => (
                  <span className="text-green-600 font-medium">{row.completed}</span>
                ),
              },
              {
                key: 'failed',
                header: 'Failed',
                render: (row) => (
                  <span className="text-red-600 font-medium">{row.failed}</span>
                ),
              },
              {
                key: 'rate',
                header: 'Success Rate',
                render: (row) => {
                  const rate = row.totalRuns > 0 
                    ? (row.completed / row.totalRuns) * 100 
                    : 0;
                  return (
                    <span className={rate >= 90 ? 'text-green-600' : rate >= 70 ? 'text-yellow-600' : 'text-red-600'}>
                      {formatPercentage(rate)}
                    </span>
                  );
                },
              },
            ]}
            emptyMessage="No step data available"
          />
        </Card>

        {/* Recent Telemetry */}
        <Card title="Recent Activity">
          <Table
            data={telemetry.recentTelemetry}
            columns={[
              {
                key: 'territoryId',
                header: 'Territory',
                render: (row) => (
                  <span className="text-xs font-mono">{row.territoryId.slice(0, 12)}</span>
                ),
              },
              {
                key: 'spiderType',
                header: 'Spider',
                render: (row) => (
                  <span className="text-sm">{row.spiderType}</span>
                ),
              },
              {
                key: 'step',
                header: 'Step',
                render: (row) => (
                  <StatusBadge status={row.step} />
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
                key: 'gazettesFound',
                header: 'Gazettes',
                render: (row) => (
                  <span className="text-sm">{row.gazettesFound ?? '-'}</span>
                ),
              },
              {
                key: 'executionTimeMs',
                header: 'Time',
                render: (row) => (
                  <span className="text-sm">
                    {row.executionTimeMs ? formatDuration(row.executionTimeMs) : '-'}
                  </span>
                ),
              },
              {
                key: 'timestamp',
                header: 'When',
                render: (row) => (
                  <span className="text-sm text-gray-600">
                    {formatRelativeTime(row.timestamp)}
                  </span>
                ),
              },
            ]}
            emptyMessage="No recent telemetry"
          />
        </Card>
      </div>
    </DashboardLayout>
  );
}

