/**
 * Dashboard layout with navigation sidebar
 */

import React from 'react';

interface LayoutProps {
  children: React.ReactNode;
  currentPath?: string;
}

const navItems = [
  { path: '/dashboard', label: 'Overview', icon: '📊' },
  { path: '/dashboard/crawl-progress', label: 'Crawl Progress', icon: '🕷️' },
  { path: '/dashboard/errors', label: 'Errors', icon: '❌' },
  { path: '/dashboard/telemetry', label: 'Telemetry', icon: '📈' },
  { path: '/dashboard/gazettes', label: 'Gazettes', icon: '📰' },
  { path: '/dashboard/ocr', label: 'OCR', icon: '📝' },
  { path: '/dashboard/webhooks', label: 'Webhooks', icon: '🔔' },
  { path: '/dashboard/concursos', label: 'Concursos', icon: '🎓' },
];

export function DashboardLayout({ children, currentPath = '' }: LayoutProps) {
  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-full mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <h1 className="text-2xl font-bold text-gray-900">
                Querido Diário Dashboard
              </h1>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-sm text-gray-600">
                Goodfellow Pipeline Monitor
              </div>
              <a
                href="/dashboard/logout"
                className="text-sm text-gray-600 hover:text-gray-900 transition-colors"
              >
                Logout
              </a>
            </div>
          </div>
        </div>
      </header>

      <div className="flex">
        {/* Sidebar Navigation */}
        <aside className="w-64 bg-white shadow-sm min-h-[calc(100vh-4rem)] sticky top-16">
          <nav className="p-4 space-y-1">
            {navItems.map((item) => {
              const isActive = currentPath === item.path;
              return (
                <a
                  key={item.path}
                  href={item.path}
                  className={`flex items-center px-4 py-3 text-sm font-medium rounded-lg transition-colors ${
                    isActive
                      ? 'bg-primary-100 text-primary-700'
                      : 'text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  <span className="mr-3 text-lg">{item.icon}</span>
                  {item.label}
                </a>
              );
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main className="flex-1 p-6">
          <div className="max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}

