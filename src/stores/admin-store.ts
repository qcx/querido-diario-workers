/**
 * Zustand Store for Admin Page
 */

import { create } from 'zustand';
import type { AdminPageData, ErrorLogData } from '../types/dashboard';

interface AdminState extends AdminPageData {
  setData: (data: AdminPageData) => void;
  errorFilter: string;
  setErrorFilter: (filter: string) => void;
  filteredErrors: () => ErrorLogData[];
}

export const useAdminStore = create<AdminState>((set, get) => ({
  dbHealth: {
    healthy: false,
    latency: null,
    error: null,
  },
  spiders: [],
  webhooks: [],
  errors: [],
  dbStats: {
    tablesCount: 0,
    recordsCounts: {},
  },
  errorFilter: 'all',

  setData: (data: AdminPageData) => set(data),

  setErrorFilter: (filter: string) => set({ errorFilter: filter }),

  filteredErrors: () => {
    const state = get();
    if (state.errorFilter === 'all') {
      return state.errors;
    }
    return state.errors.filter((error) => error.severity === state.errorFilter);
  },
}));


