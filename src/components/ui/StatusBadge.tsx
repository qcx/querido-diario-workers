/**
 * StatusBadge - Colored status indicators
 */

import React from 'react';

interface StatusBadgeProps {
  status: 'success' | 'failure' | 'pending' | 'processing' | 'warning' | 'completed' | 'failed' | 'running';
  label?: string;
}

export default function StatusBadge({ status, label }: StatusBadgeProps) {
  const statusConfig = {
    success: { bg: 'bg-green-100', text: 'text-green-800', label: 'Success' },
    completed: { bg: 'bg-green-100', text: 'text-green-800', label: 'Completed' },
    failure: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failure' },
    failed: { bg: 'bg-red-100', text: 'text-red-800', label: 'Failed' },
    pending: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Pending' },
    processing: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Processing' },
    running: { bg: 'bg-blue-100', text: 'text-blue-800', label: 'Running' },
    warning: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Warning' },
  };

  const config = statusConfig[status];
  const displayLabel = label || config.label;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}>
      {displayLabel}
    </span>
  );
}


