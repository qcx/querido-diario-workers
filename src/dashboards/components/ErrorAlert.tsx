/**
 * Error alert component
 */

import { getSeverityColor } from '../utils/formatters';

interface ErrorAlertProps {
  severity: 'warning' | 'error' | 'critical';
  title: string;
  message?: string;
  className?: string;
}

export function ErrorAlert({
  severity,
  title,
  message,
  className = '',
}: ErrorAlertProps) {
  return (
    <div
      className={`rounded-lg border p-4 ${getSeverityColor(severity)} ${className}`}
    >
      <div className="flex">
        <div className="flex-1">
          <h4 className="font-semibold">{title}</h4>
          {message && <p className="mt-1 text-sm">{message}</p>}
        </div>
      </div>
    </div>
  );
}

