/**
 * Findings Breakdown Component
 * Show analysis findings by type with confidence scores
 */

import React from 'react';
import { Card } from './Card';

interface Finding {
  type: string;
  confidence: number;
  data: Record<string, any>;
}

interface FindingsBreakdownProps {
  findings: Finding[];
  title?: string;
  showDetails?: boolean;
  maxItems?: number;
  className?: string;
}

function getConfidenceBadgeColor(confidence: number): string {
  if (confidence >= 0.8) return 'bg-green-100 text-green-800';
  if (confidence >= 0.6) return 'bg-yellow-100 text-yellow-800';
  return 'bg-orange-100 text-orange-800';
}

function formatConfidence(confidence: number): string {
  return `${Math.round(confidence * 100)}%`;
}

export function FindingsBreakdown({
  findings,
  title = 'Analysis Findings',
  showDetails = false,
  maxItems,
  className = '',
}: FindingsBreakdownProps) {
  // Group findings by type
  const findingsByType = findings.reduce((acc, finding) => {
    if (!acc[finding.type]) {
      acc[finding.type] = [];
    }
    acc[finding.type].push(finding);
    return acc;
  }, {} as Record<string, Finding[]>);

  // Calculate stats per type
  const typeStats = Object.entries(findingsByType).map(([type, items]) => ({
    type,
    count: items.length,
    avgConfidence: items.reduce((sum, f) => sum + f.confidence, 0) / items.length,
    highConfidence: items.filter((f) => f.confidence >= 0.8).length,
    findings: items,
  }));

  // Sort by count descending
  typeStats.sort((a, b) => b.count - a.count);

  const displayStats = maxItems ? typeStats.slice(0, maxItems) : typeStats;
  const hasMore = maxItems && typeStats.length > maxItems;

  if (findings.length === 0) {
    return (
      <Card title={title} className={className}>
        <p className="text-gray-500 text-sm text-center py-4">No findings</p>
      </Card>
    );
  }

  return (
    <Card title={title} className={className}>
      <div className="space-y-3">
        {/* Summary Stats */}
        <div className="grid grid-cols-3 gap-4 pb-3 border-b border-gray-200">
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">{findings.length}</div>
            <div className="text-xs text-gray-600">Total Findings</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-gray-900">{typeStats.length}</div>
            <div className="text-xs text-gray-600">Types</div>
          </div>
          <div className="text-center">
            <div className="text-2xl font-bold text-green-600">
              {findings.filter((f) => f.confidence >= 0.8).length}
            </div>
            <div className="text-xs text-gray-600">High Confidence</div>
          </div>
        </div>

        {/* Findings by Type */}
        {displayStats.map((stat) => (
          <div key={stat.type} className="border border-gray-200 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center space-x-2">
                <span className="font-medium text-gray-900 capitalize">
                  {stat.type.replace(/_/g, ' ')}
                </span>
                <span className="px-2 py-0.5 text-xs font-semibold bg-blue-100 text-blue-800 rounded">
                  {stat.count}
                </span>
              </div>
              <span
                className={`px-2 py-0.5 text-xs font-semibold rounded ${getConfidenceBadgeColor(
                  stat.avgConfidence
                )}`}
              >
                {formatConfidence(stat.avgConfidence)} avg
              </span>
            </div>

            {/* Progress bar showing high confidence ratio */}
            <div className="w-full bg-gray-200 rounded-full h-1.5 mb-2">
              <div
                className="bg-green-500 h-1.5 rounded-full"
                style={{ width: `${(stat.highConfidence / stat.count) * 100}%` }}
              />
            </div>

            <div className="text-xs text-gray-600">
              {stat.highConfidence} high confidence ({Math.round((stat.highConfidence / stat.count) * 100)}%)
            </div>

            {/* Show details if requested */}
            {showDetails && (
              <div className="mt-3 space-y-2 border-t border-gray-100 pt-2">
                {stat.findings.slice(0, 3).map((finding, idx) => (
                  <div key={idx} className="text-xs bg-gray-50 rounded p-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-700">Finding {idx + 1}</span>
                      <span
                        className={`px-1.5 py-0.5 text-xs font-semibold rounded ${getConfidenceBadgeColor(
                          finding.confidence
                        )}`}
                      >
                        {formatConfidence(finding.confidence)}
                      </span>
                    </div>
                    <div className="text-gray-600">
                      {Object.entries(finding.data)
                        .slice(0, 2)
                        .map(([key, value]) => (
                          <div key={key}>
                            <span className="font-medium">{key}:</span>{' '}
                            {typeof value === 'string' ? value : JSON.stringify(value)}
                          </div>
                        ))}
                    </div>
                  </div>
                ))}
                {stat.findings.length > 3 && (
                  <div className="text-xs text-gray-500 text-center">
                    +{stat.findings.length - 3} more findings
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {hasMore && (
          <div className="text-sm text-gray-500 text-center pt-2">
            +{typeStats.length - maxItems!} more types
          </div>
        )}
      </div>
    </Card>
  );
}

