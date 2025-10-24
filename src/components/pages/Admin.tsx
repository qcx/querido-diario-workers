import React, { useEffect } from 'react';
import { useAdminStore } from '../../stores/admin-store';
import StatsCard from '../ui/StatsCard';
import SectionCard from '../ui/SectionCard';
import DataTable from '../ui/DataTable';
import StatusBadge from '../ui/StatusBadge';

declare global {
  interface Window {
    __INITIAL_DATA__: any;
  }
}

export default function Admin() {
  const store = useAdminStore();

  useEffect(() => {
    if (typeof window !== 'undefined' && window.__INITIAL_DATA__) {
      store.setData(window.__INITIAL_DATA__);
    }
  }, []);

  const { dbHealth, spiders, webhooks, errors, dbStats } = store;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Admin Panel</h1>
        <p className="mt-2 text-gray-600">System administration and monitoring</p>
      </div>

      {/* System Health */}
      <SectionCard title="System Health" className="mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <StatusBadge status={dbHealth.healthy ? 'success' : 'failure'} label="Database" />
            </div>
            <p className="text-sm text-gray-600 mt-2">
              {dbHealth.healthy ? (
                <span>Latency: {dbHealth.latency}ms</span>
              ) : (
                <span className="text-red-600">{dbHealth.error}</span>
              )}
            </p>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <StatusBadge status="success" label="Worker" />
            </div>
            <p className="text-sm text-gray-600 mt-2">All systems operational</p>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <div className="flex items-center justify-center mb-2">
              <StatusBadge status="success" label="Queues" />
            </div>
            <p className="text-sm text-gray-600 mt-2">Processing normally</p>
          </div>
        </div>
      </SectionCard>

      {/* Database Statistics */}
      <SectionCard title="Database Statistics" className="mb-8">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {Object.entries(dbStats.recordsCounts || {}).map(([table, count]) => (
            <div key={table} className="text-center p-4 bg-gray-50 rounded-lg">
              <p className="text-2xl font-bold text-gray-900">{count.toLocaleString()}</p>
              <p className="text-xs text-gray-600 mt-1">{table.replace('_', ' ')}</p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* Spider Registry */}
      <SectionCard title="Spider Registry" className="mb-8">
        <DataTable
          headers={['Platform', 'Type', 'Cities', 'Status']}
          rows={spiders.map((spider) => [
            spider.platform,
            spider.type,
            spider.citiesCount,
            <StatusBadge key={spider.id} status={spider.isActive ? 'success' : 'failure'} label={spider.isActive ? 'Active' : 'Inactive'} />,
          ])}
          emptyMessage="No spiders configured"
        />
      </SectionCard>

      {/* Webhook Deliveries */}
      <SectionCard title="Recent Webhook Deliveries" className="mb-8">
        <DataTable
          headers={['Notification ID', 'Event Type', 'Status', 'Attempts', 'Status Code', 'Created At']}
          rows={webhooks.map((webhook) => [
            webhook.notificationId.substring(0, 16) + '...',
            webhook.eventType,
            <StatusBadge key={webhook.id} status={webhook.status as any} />,
            webhook.attempts,
            webhook.statusCode || 'N/A',
            new Date(webhook.createdAt).toLocaleString(),
          ])}
          emptyMessage="No webhook deliveries found"
        />
      </SectionCard>

      {/* Error Console */}
      <SectionCard 
        title="Error Console" 
        className="mb-8"
        action={
          <select
            className="px-3 py-1 border border-gray-300 rounded text-sm"
            value={store.errorFilter}
            onChange={(e) => store.setErrorFilter(e.target.value)}
          >
            <option value="all">All Errors</option>
            <option value="critical">Critical</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
          </select>
        }
      >
        <div className="space-y-4">
          {store.filteredErrors().length === 0 ? (
            <p className="text-gray-500 text-center py-8">No errors found</p>
          ) : (
            store.filteredErrors().slice(0, 10).map((error) => (
              <div key={error.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex justify-between items-start mb-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <StatusBadge
                        status={
                          error.severity === 'critical'
                            ? 'failure'
                            : error.severity === 'error'
                            ? 'warning'
                            : 'pending'
                        }
                        label={error.severity}
                      />
                      <span className="font-medium text-gray-900">{error.operationType}</span>
                    </div>
                    {error.territoryId && (
                      <p className="text-xs text-gray-500 mt-1">Territory: {error.territoryId}</p>
                    )}
                  </div>
                  <span className="text-xs text-gray-500">
                    {new Date(error.createdAt).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm text-gray-700 mt-2">{error.errorMessage}</p>
                {error.errorCode && (
                  <p className="text-xs text-gray-500 mt-1">Code: {error.errorCode}</p>
                )}
                {error.resolvedAt && (
                  <div className="mt-2 text-xs text-green-600">
                    ✓ Resolved at {new Date(error.resolvedAt).toLocaleString()}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </SectionCard>
    </div>
  );
}

