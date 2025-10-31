/**
 * React Router 7 configuration for dashboards
 * NOTE: This file is not currently used - we're using pure SSR instead
 */

import {
  createBrowserRouter,
  createMemoryRouter,
  RouterProvider,
} from 'react-router-dom';
import type { RouteObject } from 'react-router-dom';

// Import all dashboard pages and loaders
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
} from './pages';

/**
 * Dashboard routes configuration
 */
export const dashboardRoutes: RouteObject[] = [
  {
    path: '/dashboard',
    element: <OverviewPage />,
    loader: overviewLoader,
  },
  {
    path: '/dashboard/crawl-progress',
    element: <CrawlProgressPage />,
    loader: crawlProgressLoader,
  },
  {
    path: '/dashboard/errors',
    element: <ErrorsPage />,
    loader: errorsLoader,
  },
  {
    path: '/dashboard/telemetry',
    element: <TelemetryPage />,
    loader: telemetryLoader,
  },
  {
    path: '/dashboard/gazettes',
    element: <GazettesPage />,
    loader: gazettesLoader,
  },
  {
    path: '/dashboard/ocr',
    element: <OcrPage />,
    loader: ocrLoader,
  },
  {
    path: '/dashboard/webhooks',
    element: <WebhooksPage />,
    loader: webhooksLoader,
  },
  {
    path: '/dashboard/concursos',
    element: <ConcursosPage />,
    loader: concursosLoader,
  },
];

/**
 * Create router for browser (client-side)
 */
export function createDashboardRouter() {
  return createBrowserRouter(dashboardRoutes);
}

/**
 * Create router for SSR (server-side)
 */
export function createServerRouter(url: string) {
  return createMemoryRouter(dashboardRoutes, {
    initialEntries: [url],
    initialIndex: 0,
  });
}

/**
 * Dashboard App component
 */
export function DashboardApp({ router }: { router: any }) {
  return <RouterProvider router={router} />;
}

