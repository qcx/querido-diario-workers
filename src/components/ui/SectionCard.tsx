/**
 * SectionCard - Container card for sections
 */

import React from 'react';

interface SectionCardProps {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export default function SectionCard({ title, children, action, className = '' }: SectionCardProps) {
  return (
    <div className={`bg-white rounded-lg shadow overflow-hidden ${className}`}>
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">{title}</h3>
        {action && <div>{action}</div>}
      </div>
      <div className="px-6 py-4">
        {children}
      </div>
    </div>
  );
}


