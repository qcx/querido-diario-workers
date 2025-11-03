/**
 * Client-side entry point for dashboard hydration
 */

import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { dashboardRoutes } from '../router';

// Create browser router
const router = createBrowserRouter(dashboardRoutes);

// Hydrate the app
const rootElement = document.getElementById('root');

if (rootElement) {
  hydrateRoot(
    rootElement,
    <React.StrictMode>
      <RouterProvider router={router} />
    </React.StrictMode>
  );
} else {
  console.error('Root element not found for hydration');
}

