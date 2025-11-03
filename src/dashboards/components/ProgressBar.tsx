/**
 * Progress bar component
 */

import { getProgressColor, formatPercentage } from '../utils/formatters';

interface ProgressBarProps {
  percentage: number;
  showLabel?: boolean;
  label?: string;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function ProgressBar({
  percentage,
  showLabel = true,
  label,
  className = '',
  size = 'md',
}: ProgressBarProps) {
  const heightClass = {
    sm: 'h-1',
    md: 'h-2',
    lg: 'h-4',
  }[size];

  return (
    <div className={className}>
      {(showLabel || label) && (
        <div className="flex items-center justify-between mb-1">
          {label && <span className="text-sm text-gray-600">{label}</span>}
          {showLabel && (
            <span className="text-sm font-medium text-gray-900">
              {formatPercentage(percentage, 0)}
            </span>
          )}
        </div>
      )}
      <div className={`w-full bg-gray-200 rounded-full overflow-hidden ${heightClass}`}>
        <div
          className={`${heightClass} ${getProgressColor(percentage)} transition-all duration-300`}
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </div>
    </div>
  );
}

