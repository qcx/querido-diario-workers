/**
 * Loader data context for SSR
 * Provides a way to pass loader data to components without React Router
 */

import React, { createContext, useContext } from 'react';

// Create context
const LoaderDataContext = createContext<any>(null);

/**
 * Provider component
 */
export function LoaderDataProvider({ children, data }: { children: React.ReactNode; data: any }) {
  return (
    <LoaderDataContext.Provider value={data}>
      {children}
    </LoaderDataContext.Provider>
  );
}

/**
 * Hook to access loader data
 * Compatible with React Router's useLoaderData() API
 */
export function useLoaderData<T = any>(): T {
  const data = useContext(LoaderDataContext);
  
  if (data === null) {
    throw new Error('useLoaderData must be used within LoaderDataProvider');
  }
  
  return data;
}

