/**
 * Zustand Store for Reports Page
 */

import { create } from 'zustand';
import type { ReportsPageData } from '../types/dashboard';

interface ReportsState extends ReportsPageData {
  setData: (data: ReportsPageData) => void;
  selectedState: string | null;
  setSelectedState: (uf: string | null) => void;
}

export const useReportsStore = create<ReportsState>((set) => ({
  overview: {
    totalGazettes: 0,
    totalOcrJobs: 0,
    totalAnalyses: 0,
    totalConcursos: 0,
    ocrSuccessRate: 0,
    analysisSuccessRate: 0,
    avgProcessingTimeMs: 0,
  },
  coverage: [],
  trends: [],
  concursos: [],
  errors: {
    totalErrors: 0,
    criticalErrors: 0,
    errorsByType: {},
    errorsBySeverity: {},
    recentErrorRate: 0,
  },
  selectedState: null,

  setData: (data: ReportsPageData) => set(data),

  setSelectedState: (uf: string | null) => set({ selectedState: uf }),
}));


