/**
 * Utility functions for formatting data in dashboards
 */

import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

/**
 * Format a date string to human-readable format
 */
export function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
    return format(date, 'dd/MM/yyyy HH:mm', { locale: ptBR });
  } catch (error) {
    return 'Invalid date';
  }
}

/**
 * Format a date to just the date part
 */
export function formatDateOnly(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
    return format(date, 'dd/MM/yyyy', { locale: ptBR });
  } catch (error) {
    return 'Invalid date';
  }
}

/**
 * Format a date as relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(dateString: string | null | undefined): string {
  if (!dateString) return 'N/A';
  
  try {
    const date = typeof dateString === 'string' ? parseISO(dateString) : dateString;
    return formatDistanceToNow(date, { addSuffix: true, locale: ptBR });
  } catch (error) {
    return 'Invalid date';
  }
}

/**
 * Format duration in milliseconds to human-readable format
 */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return 'N/A';
  
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  if (ms < 3600000) return `${(ms / 60000).toFixed(2)}min`;
  return `${(ms / 3600000).toFixed(2)}h`;
}

/**
 * Format a number as percentage
 */
export function formatPercentage(value: number | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined) return 'N/A';
  return `${value.toFixed(decimals)}%`;
}

/**
 * Format a number with thousands separator
 */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'N/A';
  return value.toLocaleString('pt-BR');
}

/**
 * Get color class for status badge
 */
export function getStatusColor(status: string): string {
  const statusColors: Record<string, string> = {
    // Job statuses
    pending: 'bg-yellow-100 text-yellow-800',
    running: 'bg-blue-100 text-blue-800',
    completed: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    
    // Step statuses
    started: 'bg-blue-100 text-blue-800',
    skipped: 'bg-gray-100 text-gray-800',
    
    // OCR statuses
    processing: 'bg-blue-100 text-blue-800',
    success: 'bg-green-100 text-green-800',
    failure: 'bg-red-100 text-red-800',
    partial: 'bg-orange-100 text-orange-800',
    
    // Webhook statuses
    sent: 'bg-green-100 text-green-800',
    retry: 'bg-orange-100 text-orange-800',
    
    // Gazette statuses
    created: 'bg-gray-100 text-gray-800',
    uploaded: 'bg-blue-100 text-blue-800',
    ocr_processing: 'bg-blue-100 text-blue-800',
    ocr_retrying: 'bg-orange-100 text-orange-800',
    ocr_failure: 'bg-red-100 text-red-800',
    ocr_success: 'bg-green-100 text-green-800',
    analysis_pending: 'bg-yellow-100 text-yellow-800',
  };
  
  return statusColors[status] || 'bg-gray-100 text-gray-800';
}

/**
 * Get color class for severity level
 */
export function getSeverityColor(severity: string): string {
  const severityColors: Record<string, string> = {
    warning: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    error: 'bg-orange-100 text-orange-800 border-orange-200',
    critical: 'bg-red-100 text-red-800 border-red-200',
  };
  
  return severityColors[severity] || 'bg-gray-100 text-gray-800 border-gray-200';
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string | null | undefined, maxLength: number = 50): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Calculate completion percentage
 */
export function calculatePercentage(completed: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((completed / total) * 100);
}

/**
 * Get progress bar color based on percentage
 */
export function getProgressColor(percentage: number): string {
  if (percentage < 30) return 'bg-red-500';
  if (percentage < 70) return 'bg-yellow-500';
  return 'bg-green-500';
}

