/**
 * Pipeline Status Indicator Component
 * Visual indicator for crawl → OCR → analysis stages
 */

import React from 'react';

interface PipelineStage {
  name: string;
  status: 'completed' | 'in_progress' | 'pending' | 'failed' | 'unknown';
  label?: string;
}

interface PipelineStatusIndicatorProps {
  stages: PipelineStage[];
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const statusColors = {
  completed: 'bg-green-500 border-green-600',
  in_progress: 'bg-yellow-500 border-yellow-600 animate-pulse',
  pending: 'bg-gray-300 border-gray-400',
  failed: 'bg-red-500 border-red-600',
  unknown: 'bg-gray-200 border-gray-300',
};

const statusIcons = {
  completed: '✓',
  in_progress: '⟳',
  pending: '○',
  failed: '✕',
  unknown: '?',
};

const sizeClasses = {
  sm: 'h-6 w-6 text-xs',
  md: 'h-8 w-8 text-sm',
  lg: 'h-10 w-10 text-base',
};

const connectorSizes = {
  sm: 'w-8 h-0.5',
  md: 'w-12 h-0.5',
  lg: 'w-16 h-1',
};

export function PipelineStatusIndicator({ 
  stages, 
  size = 'md',
  className = '' 
}: PipelineStatusIndicatorProps) {
  return (
    <div className={`flex items-center ${className}`}>
      {stages.map((stage, index) => (
        <React.Fragment key={stage.name}>
          {/* Stage Circle */}
          <div className="flex flex-col items-center">
            <div
              className={`
                ${sizeClasses[size]}
                ${statusColors[stage.status]}
                rounded-full border-2
                flex items-center justify-center
                font-semibold text-white
                transition-all duration-300
              `}
              title={`${stage.name}: ${stage.status}`}
            >
              {statusIcons[stage.status]}
            </div>
            {stage.label && (
              <span className="text-xs text-gray-600 mt-1 text-center whitespace-nowrap">
                {stage.label}
              </span>
            )}
          </div>

          {/* Connector Line */}
          {index < stages.length - 1 && (
            <div
              className={`
                ${connectorSizes[size]}
                mx-1
                ${
                  stages[index + 1].status === 'completed' || stages[index + 1].status === 'in_progress'
                    ? 'bg-green-400'
                    : stages[index + 1].status === 'failed'
                    ? 'bg-red-400'
                    : 'bg-gray-300'
                }
                transition-all duration-300
              `}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

