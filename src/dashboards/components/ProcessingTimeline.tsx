/**
 * Processing Timeline Component
 * Timeline visualization of processing stages
 */

import React from 'react';
import { Card } from './Card';
import { formatRelativeTime } from '../utils/formatters';

interface TimelineEvent {
  stage: string;
  timestamp: string | null;
  status: 'completed' | 'in_progress' | 'failed' | 'pending';
  duration?: number; // in milliseconds
  details?: string;
}

interface ProcessingTimelineProps {
  events: TimelineEvent[];
  title?: string;
  className?: string;
}

const statusColors = {
  completed: 'bg-green-500 border-green-600 text-white',
  in_progress: 'bg-yellow-500 border-yellow-600 text-white',
  failed: 'bg-red-500 border-red-600 text-white',
  pending: 'bg-gray-300 border-gray-400 text-gray-600',
};

const statusIcons = {
  completed: (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
        clipRule="evenodd"
      />
    </svg>
  ),
  in_progress: (
    <svg className="w-4 h-4 animate-spin" fill="currentColor" viewBox="0 0 20 20">
      <path d="M10 3a7 7 0 100 14 7 7 0 000-14zm0 2a5 5 0 110 10 5 5 0 010-10z" />
    </svg>
  ),
  failed: (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <path
        fillRule="evenodd"
        d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
        clipRule="evenodd"
      />
    </svg>
  ),
  pending: (
    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="3" />
    </svg>
  ),
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

export function ProcessingTimeline({
  events,
  title = 'Processing Timeline',
  className = '',
}: ProcessingTimelineProps) {
  if (events.length === 0) {
    return (
      <Card title={title} className={className}>
        <p className="text-gray-500 text-sm text-center py-4">No timeline data</p>
      </Card>
    );
  }

  // Calculate total processing time
  const totalDuration = events.reduce((sum, event) => sum + (event.duration || 0), 0);

  return (
    <Card title={title} className={className}>
      <div className="space-y-4">
        {/* Total Duration */}
        {totalDuration > 0 && (
          <div className="bg-blue-50 rounded-lg p-3 mb-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-blue-900">Total Processing Time</span>
              <span className="text-lg font-bold text-blue-700">
                {formatDuration(totalDuration)}
              </span>
            </div>
          </div>
        )}

        {/* Timeline */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />

          {/* Events */}
          <div className="space-y-6">
            {events.map((event, index) => (
              <div key={index} className="relative flex items-start pl-10">
                {/* Status Icon */}
                <div
                  className={`
                    absolute left-0 w-8 h-8 rounded-full border-2
                    flex items-center justify-center
                    ${statusColors[event.status]}
                  `}
                >
                  {statusIcons[event.status]}
                </div>

                {/* Event Content */}
                <div className="flex-1 bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <h4 className="text-sm font-semibold text-gray-900 capitalize">
                        {event.stage.replace(/_/g, ' ')}
                      </h4>
                      {event.details && (
                        <p className="text-xs text-gray-600 mt-1">{event.details}</p>
                      )}
                      {event.timestamp && (
                        <p className="text-xs text-gray-500 mt-1">
                          {formatRelativeTime(event.timestamp)}
                        </p>
                      )}
                    </div>
                    {event.duration && (
                      <div className="ml-4 text-right">
                        <span className="text-sm font-semibold text-gray-700">
                          {formatDuration(event.duration)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Card>
  );
}

