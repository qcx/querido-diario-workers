/**
 * Gazette Detail Page
 * Comprehensive view of a single gazette with full pipeline information
 */

import type { LoaderFunctionArgs } from 'react-router-dom';
import { DashboardLayout } from '../layout';
import {
  Card,
  StatusBadge,
  TextMetricsCard,
  FindingsBreakdown,
  ProcessingTimeline,
  PipelineStatusIndicator,
} from '../components';
import { formatDateOnly, formatRelativeTime } from '../utils/formatters';
import { getGazetteDetail, type GazetteDetail } from '../services/dashboard-data';
import { getDatabase } from '../../services/database';
import { useLoaderData } from '../loader-context';

export async function loader({ context, params }: LoaderFunctionArgs) {
  const db = getDatabase(context.env as any);
  const gazetteId = params.id;
  
  if (!gazetteId) {
    throw new Error('Gazette ID is required');
  }

  const detail = await getGazetteDetail(db, gazetteId);
  
  if (!detail) {
    throw new Error('Gazette not found');
  }

  return { detail };
}

export function GazetteDetailPage() {
  const { detail } = useLoaderData<{ detail: GazetteDetail }>();

  // Build timeline events
  const timelineEvents = [
    {
      stage: 'Gazette Crawled',
      timestamp: detail.createdAt,
      status: 'completed' as const,
      details: `Spider: ${detail.spiderId || 'unknown'}${
        detail.gazetteScope ? ` (${detail.gazetteScope})` : ''
      }`,
    },
  ];

  if (detail.ocrJobId) {
    timelineEvents.push({
      stage: 'OCR Processing',
      timestamp: detail.ocrCompletedAt,
      status:
        detail.ocrStatus === 'success'
          ? ('completed' as const)
          : detail.ocrStatus === 'failure'
          ? ('failed' as const)
          : ('in_progress' as const),
      duration: detail.ocrProcessingTimeMs || undefined,
      details: detail.ocrErrorMessage || undefined,
    });
  }

  if (detail.analysisJobId) {
    timelineEvents.push({
      stage: 'Analysis Complete',
      timestamp: detail.analysisAnalyzedAt,
      status: 'completed' as const,
      duration: detail.analysisProcessingTimeMs || undefined,
      details: `${detail.analysisTotalFindings || 0} findings detected`,
    });
  }

  // Build pipeline stages
  const pipelineStages = [
    {
      name: 'Crawl',
      status:
        detail.status === 'uploaded' || detail.status === 'ocr_success'
          ? ('completed' as const)
          : detail.status === 'pending'
          ? ('pending' as const)
          : ('unknown' as const),
      label: 'Crawled',
    },
    {
      name: 'OCR',
      status:
        detail.ocrStatus === 'success'
          ? ('completed' as const)
          : detail.ocrStatus === 'processing'
          ? ('in_progress' as const)
          : detail.ocrStatus === 'failure'
          ? ('failed' as const)
          : detail.ocrStatus === 'pending'
          ? ('pending' as const)
          : ('unknown' as const),
      label: 'OCR',
    },
    {
      name: 'Analysis',
      status: detail.analysisJobId ? ('completed' as const) : ('pending' as const),
      label: 'Analyzed',
    },
  ];

  return (
    <DashboardLayout currentPath="/dashboard/gazettes">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center space-x-3 mb-2">
              <h2 className="text-2xl font-bold text-gray-900">Gazette Details</h2>
              <StatusBadge status={detail.status} />
            </div>
            <p className="text-gray-600">
              Territory: <span className="font-medium">{detail.territoryId || 'Unknown'}</span> •
              Publication: <span className="font-medium">{formatDateOnly(detail.publicationDate)}</span>
              {detail.editionNumber && (
                <>
                  {' '}• Edition: <span className="font-medium">{detail.editionNumber}</span>
                </>
              )}
            </p>
          </div>
          <a
            href={detail.pdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            View PDF →
          </a>
        </div>

        {/* Pipeline Status */}
        <Card title="Pipeline Status">
          <div className="flex justify-center py-4">
            <PipelineStatusIndicator stages={pipelineStages} size="lg" />
          </div>
        </Card>

        {/* Gazette Information */}
        <Card title="Gazette Information">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-sm text-gray-600">Gazette ID:</span>
              <p className="font-mono text-sm mt-1">{detail.id}</p>
            </div>
            <div>
              <span className="text-sm text-gray-600">Created:</span>
              <p className="text-sm mt-1">{formatRelativeTime(detail.createdAt)}</p>
            </div>
            <div>
              <span className="text-sm text-gray-600">Spider ID:</span>
              <p className="text-sm mt-1">{detail.spiderId || 'N/A'}</p>
            </div>
            <div>
              <span className="text-sm text-gray-600">Gazette Scope:</span>
              <p className="text-sm mt-1 capitalize">{detail.gazetteScope || 'N/A'}</p>
            </div>
            {detail.crawlJobId && (
              <div>
                <span className="text-sm text-gray-600">Crawl Job ID:</span>
                <p className="font-mono text-sm mt-1">{detail.crawlJobId.slice(0, 16)}</p>
              </div>
            )}
          </div>
        </Card>

        {/* OCR Results */}
        {detail.ocrJobId && (
          <Card title="OCR Results">
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <span className="text-sm text-gray-600">Status:</span>
                  <p className="mt-1">
                    <StatusBadge status={detail.ocrStatus || 'unknown'} />
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Text Length:</span>
                  <p className="text-sm font-semibold mt-1">
                    {detail.ocrTextLength
                      ? `${new Intl.NumberFormat().format(detail.ocrTextLength)} chars`
                      : 'N/A'}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Pages Processed:</span>
                  <p className="text-sm font-semibold mt-1">{detail.ocrPagesProcessed || 'N/A'}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Processing Time:</span>
                  <p className="text-sm font-semibold mt-1">
                    {detail.ocrProcessingTimeMs
                      ? `${(detail.ocrProcessingTimeMs / 1000).toFixed(1)}s`
                      : 'N/A'}
                  </p>
                </div>
              </div>

              {detail.ocrErrorMessage && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                  <p className="text-sm font-medium text-red-800">Error:</p>
                  <p className="text-sm text-red-700 mt-1">{detail.ocrErrorMessage}</p>
                </div>
              )}

              <div>
                <span className="text-sm text-gray-600">OCR Job ID:</span>
                <p className="font-mono text-sm mt-1">{detail.ocrJobId}</p>
              </div>
            </div>
          </Card>
        )}

        {/* Analysis Results */}
        {detail.analysisJobId && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Text Metrics */}
            <TextMetricsCard
              originalLength={detail.originalOcrTextLength}
              analyzedLength={detail.analyzedTextLength}
              reductionPercentage={detail.reductionPercentage}
              filtered={detail.filtered}
            />

            {/* Analysis Summary */}
            <Card title="Analysis Summary">
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-blue-50 rounded-lg">
                    <div className="text-2xl font-bold text-blue-600">
                      {detail.analysisTotalFindings || 0}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">Total Findings</div>
                  </div>
                  <div className="text-center p-3 bg-green-50 rounded-lg">
                    <div className="text-2xl font-bold text-green-600">
                      {detail.analysisHighConfidenceFindings || 0}
                    </div>
                    <div className="text-xs text-gray-600 mt-1">High Confidence</div>
                  </div>
                </div>

                <div>
                  <span className="text-sm text-gray-600">Processing Time:</span>
                  <p className="text-sm font-semibold mt-1">
                    {detail.analysisProcessingTimeMs
                      ? `${(detail.analysisProcessingTimeMs / 1000).toFixed(1)}s`
                      : 'N/A'}
                  </p>
                </div>

                <div>
                  <span className="text-sm text-gray-600">Analyzed At:</span>
                  <p className="text-sm mt-1">
                    {detail.analysisAnalyzedAt
                      ? formatRelativeTime(detail.analysisAnalyzedAt)
                      : 'N/A'}
                  </p>
                </div>

                <div>
                  <span className="text-sm text-gray-600">Job ID:</span>
                  <p className="font-mono text-xs mt-1">{detail.analysisJobId}</p>
                </div>

                {detail.analysisCategories && detail.analysisCategories.length > 0 && (
                  <div>
                    <span className="text-sm text-gray-600 block mb-2">Categories:</span>
                    <div className="flex flex-wrap gap-2">
                      {detail.analysisCategories.map((cat, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded"
                        >
                          {cat}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {detail.analysisKeywords && detail.analysisKeywords.length > 0 && (
                  <div>
                    <span className="text-sm text-gray-600 block mb-2">Keywords:</span>
                    <div className="flex flex-wrap gap-1">
                      {detail.analysisKeywords.slice(0, 10).map((keyword, idx) => (
                        <span
                          key={idx}
                          className="px-2 py-0.5 text-xs bg-gray-100 text-gray-700 rounded"
                        >
                          {keyword}
                        </span>
                      ))}
                      {detail.analysisKeywords.length > 10 && (
                        <span className="px-2 py-0.5 text-xs text-gray-500">
                          +{detail.analysisKeywords.length - 10} more
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}

        {/* Findings Breakdown */}
        {detail.analysisFindings && detail.analysisFindings.length > 0 && (
          <FindingsBreakdown findings={detail.analysisFindings} showDetails={true} />
        )}

        {/* Processing Timeline */}
        <ProcessingTimeline events={timelineEvents} />
      </div>
    </DashboardLayout>
  );
}

