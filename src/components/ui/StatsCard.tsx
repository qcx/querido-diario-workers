/**
 * StatsCard - Display metric cards
 */

import React from 'react';

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
}

export default function StatsCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendValue,
}: StatsCardProps) {
  const trendColors = {
    up: 'text-green-600',
    down: 'text-red-600',
    neutral: 'text-gray-600',
  };

  const trendIcons = {
    up: '↑',
    down: '↓',
    neutral: '→',
  };

  return (
    <div className="bg-white rounded-lg shadow p-6">
      <div className="flex items-center justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="mt-2 text-3xl font-semibold text-gray-900">{value}</p>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
          {trend && trendValue && (
            <div className="mt-2 flex items-center">
              <span className={`text-sm font-medium ${trendColors[trend]}`}>
                {trendIcons[trend]} {trendValue}
              </span>
            </div>
          )}
        </div>
        {icon && (
          <div className="ml-4 text-4xl text-gray-400">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}


