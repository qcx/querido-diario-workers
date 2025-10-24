import React, { useEffect } from 'react';
import { useDashboardStore } from '../../stores/dashboard-store';
import StatsCard from '../ui/StatsCard';
import SectionCard from '../ui/SectionCard';
import DataTable from '../ui/DataTable';
import ProgressBar from '../ui/ProgressBar';
import StatusBadge from '../ui/StatusBadge';

declare global {
  interface Window {
    __INITIAL_DATA__: any;
  }
}

export default function Dashboard() {
  const store = useDashboardStore();

  useEffect(() => {
    if (typeof window !== 'undefined' && window.__INITIAL_DATA__) {
      store.setData(window.__INITIAL_DATA__);
    }
  }, []);

  const { activeJobs, recentJobs, processingStats, overview } = store;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-2 text-gray-600">Real-time monitoring and pipeline status</p>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Active Jobs"
          value={processingStats.activeJobsCount}
          subtitle="Currently processing"
          icon="⚙️"
        />
        <StatsCard
          title="Pending OCR"
          value={processingStats.pendingOcrJobs}
          subtitle="Awaiting processing"
          icon="📝"
        />
        <StatsCard
          title="Avg Per Day"
          value={processingStats.avgGazettesPerDay}
          subtitle="Gazettes processed"
          icon="📊"
        />
        <StatsCard
          title="Success Rate"
          value={`${processingStats.recentSuccessRate.toFixed(1)}%`}
          subtitle="Recent processing"
          icon="✅"
        />
      </div>

      {/* Pipeline Status Visual */}
      <SectionCard title="Pipeline Status" className="mb-8">
        <div className="flex items-center justify-between py-8">
          <div className="flex-1 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-blue-100 flex items-center justify-center text-2xl mb-2">
              🔍
            </div>
            <p className="font-medium text-gray-900">Crawl</p>
            <p className="text-sm text-gray-600">{overview.totalGazettes.toLocaleString()}</p>
          </div>
          <div className="flex-1 border-t-2 border-gray-300"></div>
          <div className="flex-1 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center text-2xl mb-2">
              📄
            </div>
            <p className="font-medium text-gray-900">OCR</p>
            <p className="text-sm text-gray-600">{overview.totalOcrJobs.toLocaleString()}</p>
          </div>
          <div className="flex-1 border-t-2 border-gray-300"></div>
          <div className="flex-1 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-purple-100 flex items-center justify-center text-2xl mb-2">
              🤖
            </div>
            <p className="font-medium text-gray-900">Analysis</p>
            <p className="text-sm text-gray-600">{overview.totalAnalyses.toLocaleString()}</p>
          </div>
          <div className="flex-1 border-t-2 border-gray-300"></div>
          <div className="flex-1 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-orange-100 flex items-center justify-center text-2xl mb-2">
              🔔
            </div>
            <p className="font-medium text-gray-900">Webhook</p>
            <p className="text-sm text-gray-600">Delivered</p>
          </div>
        </div>
      </SectionCard>

      {/* Active Jobs */}
      <SectionCard title="Active Jobs" className="mb-8">
        {activeJobs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">No active jobs at the moment</p>
            <p className="text-sm text-gray-400 mt-2">Jobs will appear here when processing starts</p>
          </div>
        ) : (
          <div className="space-y-4">
            {activeJobs.map((job) => (
              <div key={job.id} className="border-l-4 border-primary-500 bg-gray-50 p-4 rounded-r">
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <p className="font-medium text-gray-900">{job.id}</p>
                    <p className="text-sm text-gray-600 mt-1">Type: {job.jobType}</p>
                  </div>
                  <StatusBadge status={job.status as any} />
                </div>
                <ProgressBar
                  value={job.completedCities}
                  max={job.totalCities}
                  label={`${job.completedCities} / ${job.totalCities} cities`}
                  color="blue"
                />
                {job.failedCities > 0 && (
                  <p className="text-sm text-red-600 mt-2">
                    ⚠️ {job.failedCities} cities failed
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Recent Activity */}
      <SectionCard title="Recent Activity" className="mb-8">
        <DataTable
          headers={['Job ID', 'Type', 'Status', 'Cities', 'Completed / Failed', 'Date']}
          rows={recentJobs.map((job) => [
            job.id.substring(0, 16) + '...',
            job.jobType,
            <StatusBadge key={job.id} status={job.status as any} />,
            job.totalCities,
            `${job.completedCities} / ${job.failedCities}`,
            job.completedAt
              ? new Date(job.completedAt).toLocaleString()
              : job.startedAt
              ? 'Running...'
              : 'Pending',
          ])}
          emptyMessage="No recent jobs found"
        />
      </SectionCard>

      {/* Processing Overview */}
      <SectionCard title="Processing Overview" className="mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <p className="text-3xl font-bold text-gray-900">{overview.totalGazettes.toLocaleString()}</p>
            <p className="text-sm text-gray-600 mt-2">Total Gazettes</p>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <p className="text-3xl font-bold text-gray-900">{overview.ocrSuccessRate.toFixed(1)}%</p>
            <p className="text-sm text-gray-600 mt-2">OCR Success Rate</p>
          </div>
          <div className="text-center p-4 bg-gray-50 rounded-lg">
            <p className="text-3xl font-bold text-gray-900">
              {overview.avgProcessingTimeMs > 0
                ? `${(overview.avgProcessingTimeMs / 1000).toFixed(1)}s`
                : 'N/A'}
            </p>
            <p className="text-sm text-gray-600 mt-2">Avg Processing Time</p>
          </div>
        </div>
      </SectionCard>
    </div>
  );
}

