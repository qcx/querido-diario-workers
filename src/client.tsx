/**
 * Client-side entry point for React hydration
 */

import React from 'react';
import { hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './components/App';

// Get initial data from SSR
declare global {
  interface Window {
    __INITIAL_DATA__: any;
  }
}

const initialData = window.__INITIAL_DATA__;

// Hydrate the root element
hydrateRoot(
  document.getElementById('root')!,
  <BrowserRouter>
    <App />
  </BrowserRouter>
);


