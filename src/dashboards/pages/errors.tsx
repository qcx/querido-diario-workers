/**
 * Errors dashboard page
 */

import type { LoaderFunctionArgs } from 'react-router-dom';
import { DashboardLayout } from '../layout';
import { Card, Table, ErrorAlert } from '../components';
import { formatRelativeTime, truncate, getSeverityColor } from '../utils/formatters';
import { getErrorLogs, type ErrorLogWithContext } from '../services/dashboard-data';
import { getDatabase } from '../../services/database';
import { useLoaderData } from '../loader-context';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = getDatabase(context.env as any);
  
  // Get unresolved errors
  const unresolvedErrors = await getErrorLogs(db, { resolved: false, limit: 50 });
  
  // Get recent errors
  const recentErrors = await getErrorLogs(db, { limit: 100 });
  
  // Count by severity
  const bySeverity = {
    warning: recentErrors.filter(e => e.severity === 'warning').length,
    error: recentErrors.filter(e => e.severity === 'error').length,
    critical: recentErrors.filter(e => e.severity === 'critical').length,
  };

  return { unresolvedErrors, recentErrors, bySeverity };
}

export function ErrorsPage() {
  const { unresolvedErrors, recentErrors, bySeverity } = useLoaderData<{
    unresolvedErrors: ErrorLogWithContext[];
    recentErrors: ErrorLogWithContext[];
    bySeverity: { warning: number; error: number; critical: number };
  }>();

  return (
    <DashboardLayout currentPath="/dashboard/errors">
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Error Logs</h2>
          <p className="text-gray-600 mt-1">System errors and troubleshooting</p>
        </div>

        {/* Error Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Warnings</p>
                <p className="text-2xl font-semibold text-yellow-600">{bySeverity.warning}</p>
              </div>
              <span className="text-3xl">⚠️</span>
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Errors</p>
                <p className="text-2xl font-semibold text-orange-600">{bySeverity.error}</p>
              </div>
              <span className="text-3xl">❗</span>
            </div>
          </Card>
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Critical</p>
                <p className="text-2xl font-semibold text-red-600">{bySeverity.critical}</p>
              </div>
              <span className="text-3xl">🔴</span>
            </div>
          </Card>
        </div>

        {/* Unresolved Errors */}
        {unresolvedErrors.length > 0 && (
          <Card title={`Unresolved Errors (${unresolvedErrors.length})`}>
            <div className="space-y-3">
              {unresolvedErrors.slice(0, 5).map((error) => (
                <ErrorAlert
                  key={error.id}
                  severity={error.severity as any}
                  title={`${error.workerName} - ${error.operationType}`}
                  message={truncate(error.errorMessage, 100)}
                />
              ))}
            </div>
          </Card>
        )}

        {/* Recent Errors Table */}
        <Card title={`Recent Errors (${recentErrors.length})`}>
          <Table
            data={recentErrors}
            columns={[
              {
                key: 'severity',
                header: 'Severity',
                render: (row) => (
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-medium rounded ${getSeverityColor(
                      row.severity
                    )}`}
                  >
                    {row.severity}
                  </span>
                ),
              },
              {
                key: 'workerName',
                header: 'Worker',
                render: (row) => (
                  <span className="text-sm font-medium">{row.workerName}</span>
                ),
              },
              {
                key: 'operationType',
                header: 'Operation',
                render: (row) => (
                  <span className="text-sm">{row.operationType}</span>
                ),
              },
              {
                key: 'errorMessage',
                header: 'Message',
                render: (row) => (
                  <span className="text-sm max-w-md truncate block" title={row.errorMessage}>
                    {truncate(row.errorMessage, 60)}
                  </span>
                ),
              },
              {
                key: 'territoryId',
                header: 'Territory',
                render: (row) => (
                  <span className="text-xs font-mono">
                    {row.territoryId ? truncate(row.territoryId, 15) : '-'}
                  </span>
                ),
              },
              {
                key: 'createdAt',
                header: 'Time',
                render: (row) => (
                  <span className="text-sm text-gray-600">
                    {formatRelativeTime(row.createdAt)}
                  </span>
                ),
              },
              {
                key: 'resolvedAt',
                header: 'Status',
                render: (row) => (
                  row.resolvedAt ? (
                    <span className="text-xs text-green-600">✓ Resolved</span>
                  ) : (
                    <span className="text-xs text-red-600">⚠ Open</span>
                  )
                ),
              },
            ]}
            emptyMessage="No errors found"
          />
        </Card>
      </div>
    </DashboardLayout>
  );
}

