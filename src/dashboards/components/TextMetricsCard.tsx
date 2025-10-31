/**
 * Text Metrics Card Component
 * Display text length info with reduction percentage
 */

import React from 'react';
import { Card } from './Card';

interface TextMetricsCardProps {
  originalLength: number | null;
  analyzedLength: number | null;
  reductionPercentage: number | null;
  filtered: boolean;
  title?: string;
  className?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(num);
}

export function TextMetricsCard({
  originalLength,
  analyzedLength,
  reductionPercentage,
  filtered,
  title = 'Text Processing Metrics',
  className = '',
}: TextMetricsCardProps) {
  const hasMetrics = originalLength !== null && analyzedLength !== null;

  return (
    <Card title={title} className={className}>
      {!hasMetrics ? (
        <p className="text-gray-500 text-sm text-center py-4">No metrics available</p>
      ) : (
        <div className="space-y-4">
          {/* Original Text Length */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Original OCR Text:</span>
            <div className="text-right">
              <span className="font-semibold text-gray-900">
                {formatNumber(originalLength)} chars
              </span>
              <span className="text-xs text-gray-500 ml-2">
                ({formatBytes(originalLength)})
              </span>
            </div>
          </div>

          {/* Analyzed Text Length */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">Analyzed Text:</span>
            <div className="text-right">
              <span className="font-semibold text-gray-900">
                {formatNumber(analyzedLength)} chars
              </span>
              <span className="text-xs text-gray-500 ml-2">
                ({formatBytes(analyzedLength)})
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="border-t border-gray-200" />

          {/* Reduction Info */}
          {filtered && reductionPercentage !== null ? (
            <div className="bg-green-50 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <svg
                    className="w-5 h-5 text-green-600 mr-2"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  <span className="text-sm font-medium text-green-900">
                    Text Filtered
                  </span>
                </div>
                <span className="text-lg font-bold text-green-700">
                  -{reductionPercentage}%
                </span>
              </div>
              <p className="text-xs text-green-700 mt-1 ml-7">
                State gazette filtered to relevant city content
              </p>
            </div>
          ) : (
            <div className="bg-blue-50 rounded-lg p-3">
              <div className="flex items-center">
                <svg
                  className="w-5 h-5 text-blue-600 mr-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-sm text-blue-900">
                  Full text analyzed (no filtering)
                </span>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

