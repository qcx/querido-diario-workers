/**
 * Server-side renderer for dashboard pages
 * Simplified version without React Router - renders components directly
 */

import React from 'react';
import { renderToString } from 'react-dom/server';
import { createHtmlTemplate } from './templates/html-template';
import { LoaderDataProvider } from './loader-context';

// Import all page components and loaders
import {
  OverviewPage,
  overviewLoader,
  CrawlProgressPage,
  crawlProgressLoader,
  ErrorsPage,
  errorsLoader,
  TelemetryPage,
  telemetryLoader,
  GazettesPage,
  gazettesLoader,
  OcrPage,
  ocrLoader,
  WebhooksPage,
  webhooksLoader,
  ConcursosPage,
  concursosLoader,
  AICostsPage,
  aiCostsLoader,
} from './pages';
import { LoginPage } from './pages/login';

/**
 * Map of routes to their components and loaders
 */
const routeMap: Record<string, { Component: React.FC<any>; loader: any }> = {
  '/dashboard': { Component: OverviewPage, loader: overviewLoader },
  '/dashboard/crawl-progress': { Component: CrawlProgressPage, loader: crawlProgressLoader },
  '/dashboard/errors': { Component: ErrorsPage, loader: errorsLoader },
  '/dashboard/telemetry': { Component: TelemetryPage, loader: telemetryLoader },
  '/dashboard/gazettes': { Component: GazettesPage, loader: gazettesLoader },
  '/dashboard/ocr': { Component: OcrPage, loader: ocrLoader },
  '/dashboard/webhooks': { Component: WebhooksPage, loader: webhooksLoader },
  '/dashboard/concursos': { Component: ConcursosPage, loader: concursosLoader },
  '/dashboard/ai-costs': { Component: AICostsPage, loader: aiCostsLoader },
};

/**
 * Render login page
 */
export function renderLoginPage(error?: string): string {
  const html = renderToString(
    <React.StrictMode>
      <LoginPage error={error} />
    </React.StrictMode>
  );
  
  return createHtmlTemplate(html);
}

/**
 * Render dashboard page on server
 */
export async function renderDashboardPage(pathname: string, context: any): Promise<string> {
  try {
    // Find matching route
    const route = routeMap[pathname];
    
    if (!route) {
      // Return 404 page
      const notFoundHtml = `
        <div class="min-h-screen bg-gray-100 flex items-center justify-center">
          <div class="bg-white p-8 rounded-lg shadow-md max-w-md">
            <h1 class="text-2xl font-bold text-gray-900 mb-4">Page Not Found</h1>
            <p class="text-gray-700 mb-4">The dashboard page you're looking for doesn't exist.</p>
            <a href="/dashboard" class="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
              Go to Dashboard Home
            </a>
          </div>
        </div>
      `;
      return createHtmlTemplate(notFoundHtml);
    }
    
    // Load data using the loader
    const loaderData = await route.loader({ context, request: new Request(`http://dummy${pathname}`) });
    
    // Render to string with loader data context
    const html = renderToString(
      <React.StrictMode>
        <LoaderDataProvider data={loaderData}>
          <route.Component />
        </LoaderDataProvider>
      </React.StrictMode>
    );
    
    // Wrap in HTML template
    return createHtmlTemplate(html);
  } catch (error) {
    console.error('Error rendering dashboard:', error);
    
    // Return error page
    const errorHtml = `
      <div class="min-h-screen bg-gray-100 flex items-center justify-center">
        <div class="bg-white p-8 rounded-lg shadow-md max-w-md">
          <h1 class="text-2xl font-bold text-red-600 mb-4">Error Loading Dashboard</h1>
          <p class="text-gray-700 mb-4">${error instanceof Error ? error.message : 'Unknown error'}</p>
          <p class="text-sm text-gray-600 mb-4">Check the server logs for more details.</p>
          <a href="/dashboard" class="inline-block px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            Return to Dashboard
          </a>
        </div>
      </div>
    `;
    
    return createHtmlTemplate(errorHtml);
  }
}

