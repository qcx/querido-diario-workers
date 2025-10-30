export interface BaseMetadata {
  version?: string;
  source?: string;
  timestamp?: string;
  [key: string]: unknown; // Allow for future extensions
}