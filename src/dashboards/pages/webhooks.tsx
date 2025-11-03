/**
 * Webhooks dashboard page
 */

import type { LoaderFunctionArgs } from 'react-router-dom';
import { DashboardLayout } from '../layout';
import { Card, Table, StatusBadge, StatCard } from '../components';
import { formatRelativeTime, formatNumber } from '../utils/formatters';
import { getWebhookStats, type WebhookStats } from '../services/dashboard-data';
import { getDatabase } from '../../services/database';
import { useLoaderData } from '../loader-context';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = getDatabase(context.env as any);
  const webhookStats = await getWebhookStats(db);
  return { webhookStats };
}

export function WebhooksPage() {
  const { webhookStats } = useLoaderData<{ webhookStats: WebhookStats }>();

  const total = webhookStats.pending + webhookStats.sent + webhookStats.failed + webhookStats.retry;
  const successRate = total > 0 ? ((webhookStats.sent / total) * 100).toFixed(1) : '0';

  return (
    <DashboardLayout currentPath="/dashboard/webhooks">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Webhook Deliveries</h2>
          <p className="text-gray-600 mt-1">Webhook delivery logs and statistics</p>
        </div>

        {/* Webhook Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard
            title="Success Rate"
            value={`${successRate}%`}
            subtitle={`${webhookStats.sent} delivered`}
          />
          <StatCard
            title="Avg Attempts"
            value={webhookStats.avgAttempts.toFixed(1)}
            subtitle="Per webhook"
          />
          <StatCard
            title="Pending"
            value={formatNumber(webhookStats.pending)}
            subtitle="Waiting delivery"
          />
          <StatCard
            title="Retrying"
            value={formatNumber(webhookStats.retry)}
            subtitle="Failed, will retry"
          />
        </div>

        {/* Status Breakdown */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-2">Pending</p>
              <p className="text-3xl font-semibold text-yellow-600">{webhookStats.pending}</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-2">Sent</p>
              <p className="text-3xl font-semibold text-green-600">{webhookStats.sent}</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-2">Retry</p>
              <p className="text-3xl font-semibold text-orange-600">{webhookStats.retry}</p>
            </div>
          </Card>
          <Card>
            <div className="text-center">
              <p className="text-sm text-gray-600 mb-2">Failed</p>
              <p className="text-3xl font-semibold text-red-600">{webhookStats.failed}</p>
            </div>
          </Card>
        </div>

        {/* Recent Deliveries */}
        <Card title={`Recent Deliveries (${webhookStats.recentDeliveries.length})`}>
          <Table
            data={webhookStats.recentDeliveries}
            columns={[
              {
                key: 'id',
                header: 'ID',
                render: (row) => (
                  <span className="font-mono text-xs">{row.id.slice(0, 8)}</span>
                ),
              },
              {
                key: 'subscriptionId',
                header: 'Subscription',
                render: (row) => (
                  <span className="font-mono text-xs">{row.subscriptionId.slice(0, 12)}</span>
                ),
              },
              {
                key: 'eventType',
                header: 'Event Type',
                render: (row) => (
                  <span className="text-sm font-medium">{row.eventType}</span>
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
                key: 'attempts',
                header: 'Attempts',
                render: (row) => (
                  <span className={`text-sm ${row.attempts > 1 ? 'text-orange-600 font-medium' : ''}`}>
                    {row.attempts}
                  </span>
                ),
              },
              {
                key: 'statusCode',
                header: 'HTTP',
                render: (row) => {
                  if (!row.statusCode) return <span className="text-gray-400">-</span>;
                  const isSuccess = row.statusCode >= 200 && row.statusCode < 300;
                  return (
                    <span className={`text-sm ${isSuccess ? 'text-green-600' : 'text-red-600'}`}>
                      {row.statusCode}
                    </span>
                  );
                },
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
                key: 'deliveredAt',
                header: 'Delivered',
                render: (row) => (
                  <span className="text-sm text-gray-600">
                    {row.deliveredAt ? formatRelativeTime(row.deliveredAt) : '-'}
                  </span>
                ),
              },
            ]}
            emptyMessage="No webhook deliveries found"
          />
        </Card>
      </div>
    </DashboardLayout>
  );
}

