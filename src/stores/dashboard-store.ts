/**
 * Zustand Store for Dashboard Page
 */

import { create } from 'zustand';
import type { DashboardPageData, JobData, ProcessingStats, OverviewStats } from '../types/dashboard';

interface DashboardState extends DashboardPageData {
  setData: (data: DashboardPageData) => void;
  updateJob: (jobId: string, updates: Partial<JobData>) => void;
  refreshData: () => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  activeJobs: [],
  recentJobs: [],
  processingStats: {
    activeJobsCount: 0,
    pendingOcrJobs: 0,
    pendingAnalyses: 0,
    recentSuccessRate: 0,
    avgGazettesPerDay: 0,
  },
  overview: {
    totalGazettes: 0,
    totalOcrJobs: 0,
    totalAnalyses: 0,
    totalConcursos: 0,
    ocrSuccessRate: 0,
    analysisSuccessRate: 0,
    avgProcessingTimeMs: 0,
  },

  setData: (data: DashboardPageData) => set(data),

  updateJob: (jobId: string, updates: Partial<JobData>) => {
    set((state) => ({
      activeJobs: state.activeJobs.map((job) =>
        job.id === jobId ? { ...job, ...updates } : job
      ),
      recentJobs: state.recentJobs.map((job) =>
        job.id === jobId ? { ...job, ...updates } : job
      ),
    }));
  },

  refreshData: async () => {
    // Could implement client-side refresh if needed
    // For now, just reload the page
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  },
}));


