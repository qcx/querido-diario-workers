import React, { useEffect } from 'react';
import { useReportsStore } from '../../stores/reports-store';
import StatsCard from '../ui/StatsCard';
import SectionCard from '../ui/SectionCard';
import DataTable from '../ui/DataTable';
import ProgressBar from '../ui/ProgressBar';

declare global {
  interface Window {
    __INITIAL_DATA__: any;
  }
}

export default function Reports() {
  const store = useReportsStore();

  useEffect(() => {
    if (typeof window !== 'undefined' && window.__INITIAL_DATA__) {
      store.setData(window.__INITIAL_DATA__);
    }
  }, []);

  const { overview, coverage, trends, concursos, errors } = store;

  return (
    <div className="container mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900">Reports & Analytics</h1>
        <p className="mt-2 text-gray-600">Historical data and processing statistics</p>
      </div>

      {/* Overview Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <StatsCard
          title="Total Gazettes"
          value={overview.totalGazettes.toLocaleString()}
          subtitle="Processed gazettes"
          icon="📄"
        />
        <StatsCard
          title="OCR Success Rate"
          value={`${overview.ocrSuccessRate.toFixed(1)}%`}
          subtitle={`${overview.totalOcrJobs.toLocaleString()} jobs`}
          icon="✓"
        />
        <StatsCard
          title="Total Analyses"
          value={overview.totalAnalyses.toLocaleString()}
          subtitle="AI-powered analyses"
          icon="🤖"
        />
        <StatsCard
          title="Concursos Found"
          value={overview.totalConcursos.toLocaleString()}
          subtitle="Public tenders"
          icon="📋"
        />
      </div>

      {/* Coverage by State */}
      <SectionCard title="Coverage by State" className="mb-8">
        <div className="space-y-4">
          {coverage.length === 0 ? (
            <p className="text-gray-500 text-center py-4">Loading coverage data...</p>
          ) : (
            coverage.map((state) => (
              <div key={state.uf} className="border-b border-gray-100 pb-4 last:border-0">
                <div className="flex justify-between items-center mb-2">
                  <div>
                    <span className="font-medium text-gray-900">{state.stateName}</span>
                    <span className="ml-2 text-sm text-gray-500">({state.uf})</span>
                  </div>
                  <span className="text-sm font-medium text-gray-700">
                    {state.coveredMunicipalities} / {state.totalMunicipalities}
                  </span>
                </div>
                <ProgressBar
                  value={state.coveredMunicipalities}
                  max={state.totalMunicipalities}
                  color={state.percentage >= 90 ? 'green' : state.percentage >= 50 ? 'blue' : 'yellow'}
                />
                <p className="mt-1 text-xs text-gray-500">
                  {state.percentage.toFixed(1)}% coverage • {state.totalConfigs} configs
                </p>
              </div>
            ))
          )}
        </div>
      </SectionCard>

      {/* Processing Trends */}
      <SectionCard title="Processing Trends (Last 30 Days)" className="mb-8">
        {trends.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No trend data available</p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div>
                <p className="text-sm text-gray-600">Total Gazettes</p>
                <p className="text-2xl font-bold text-gray-900">
                  {trends.reduce((sum, t) => sum + t.gazettes, 0).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">OCR Jobs</p>
                <p className="text-2xl font-bold text-gray-900">
                  {trends.reduce((sum, t) => sum + t.ocrJobs, 0).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Analyses</p>
                <p className="text-2xl font-bold text-gray-900">
                  {trends.reduce((sum, t) => sum + t.analyses, 0).toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Concursos</p>
                <p className="text-2xl font-bold text-gray-900">
                  {trends.reduce((sum, t) => sum + t.concursos, 0).toLocaleString()}
                </p>
              </div>
            </div>
            <div className="mt-6">
              <p className="text-xs text-gray-500 mb-2">Daily Processing Volume</p>
              <div className="flex items-end space-x-1 h-32">
                {trends.slice(-15).map((trend, idx) => {
                  const maxValue = Math.max(...trends.map(t => t.gazettes), 1);
                  const height = (trend.gazettes / maxValue) * 100;
                  return (
                    <div key={idx} className="flex-1 flex flex-col items-center group">
                      <div
                        className="w-full bg-primary-500 rounded-t hover:bg-primary-600 transition-colors"
                        style={{ height: `${height}%` }}
                        title={`${trend.date}: ${trend.gazettes} gazettes`}
                      />
                      <span className="text-xs text-gray-400 mt-1 rotate-45 origin-left hidden group-hover:block">
                        {trend.date.slice(5)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      {/* Recent Concursos */}
      <SectionCard title="Recent Concurso Findings" className="mb-8">
        <DataTable
          headers={['Territory', 'Órgão', 'Edital', 'Vagas', 'Date']}
          rows={concursos.map((c) => [
            c.territoryId,
            c.orgao || 'N/A',
            c.editalNumero || 'N/A',
            c.totalVagas,
            new Date(c.publicationDate).toLocaleDateString(),
          ])}
          emptyMessage="No recent concursos found"
        />
      </SectionCard>

      {/* Error Summary */}
      <SectionCard title="Error Summary (Last 7 Days)" className="mb-8">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="text-center">
            <p className="text-4xl font-bold text-gray-900">{errors.totalErrors}</p>
            <p className="text-sm text-gray-600 mt-1">Total Errors</p>
          </div>
          <div className="text-center">
            <p className="text-4xl font-bold text-red-600">{errors.criticalErrors}</p>
            <p className="text-sm text-gray-600 mt-1">Critical Errors</p>
          </div>
          <div className="text-center">
            <p className="text-4xl font-bold text-gray-900">
              {errors.recentErrorRate.toFixed(1)}%
            </p>
            <p className="text-sm text-gray-600 mt-1">Error Rate</p>
          </div>
        </div>
        
        {Object.keys(errors.errorsBySeverity).length > 0 && (
          <div className="mt-6">
            <p className="text-sm font-medium text-gray-700 mb-3">Errors by Severity</p>
            <div className="space-y-2">
              {Object.entries(errors.errorsBySeverity).map(([severity, count]) => (
                <div key={severity} className="flex items-center">
                  <span className="w-24 text-sm text-gray-600 capitalize">{severity}</span>
                  <div className="flex-1">
                    <ProgressBar
                      value={count}
                      max={errors.totalErrors}
                      color={severity === 'critical' ? 'red' : severity === 'error' ? 'yellow' : 'blue'}
                    />
                  </div>
                  <span className="ml-4 text-sm font-medium text-gray-700">{count}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

