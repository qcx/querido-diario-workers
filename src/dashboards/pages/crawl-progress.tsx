/**
 * Crawl progress dashboard page
 */

import type { LoaderFunctionArgs } from 'react-router-dom';
import { DashboardLayout } from '../layout';
import { Card, Table, StatusBadge, ProgressBar } from '../components';
import { formatRelativeTime } from '../utils/formatters';
import { getRecentCrawlJobs, type CrawlJobWithStats } from '../services/dashboard-data';
import { getDatabase } from '../../services/database';
import { useLoaderData } from '../loader-context';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = getDatabase(context.env as any);
  const jobs = await getRecentCrawlJobs(db, 50);
  return { jobs };
}

export function CrawlProgressPage() {
  const { jobs } = useLoaderData<{ jobs: CrawlJobWithStats[] }>();

  return (
    <DashboardLayout currentPath="/dashboard/crawl-progress">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Crawl Progress</h2>
          <p className="text-gray-600 mt-1">Monitor crawling job status and progress</p>
        </div>

        <Card title={`Crawl Jobs (${jobs.length})`}>
          <Table
            data={jobs}
            columns={[
              {
                key: 'id',
                header: 'Job ID',
                render: (row) => (
                  <span className="font-mono text-xs">{row.id.slice(0, 8)}</span>
                ),
              },
              {
                key: 'jobType',
                header: 'Type',
                render: (row) => (
                  <StatusBadge status={row.jobType} />
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
                key: 'progress',
                header: 'Progress',
                render: (row) => (
                  <div className="w-32">
                    <ProgressBar
                      percentage={row.completionPercentage}
                      showLabel={true}
                      size="sm"
                    />
                  </div>
                ),
              },
              {
                key: 'cities',
                header: 'Cities',
                render: (row) => (
                  <span className="text-sm">
                    {row.completedCities} / {row.totalCities}
                  </span>
                ),
              },
              {
                key: 'failed',
                header: 'Failed',
                render: (row) => (
                  <span className={row.failedCities > 0 ? 'text-red-600 font-medium' : 'text-gray-600'}>
                    {row.failedCities}
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
                key: 'duration',
                header: 'Duration',
                render: (row) => {
                  if (!row.startedAt) return <span className="text-gray-400">-</span>;
                  const endTime = row.completedAt || new Date().toISOString();
                  const start = new Date(row.startedAt);
                  const end = new Date(endTime);
                  const durationMs = end.getTime() - start.getTime();
                  const minutes = Math.floor(durationMs / 60000);
                  return <span className="text-sm">{minutes}m</span>;
                },
              },
            ]}
            emptyMessage="No crawl jobs found"
          />
        </Card>
      </div>
    </DashboardLayout>
  );
}

