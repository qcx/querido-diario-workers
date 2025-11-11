/**
 * V2 Analysis Orchestrator Entry Point
 * Re-exports the AnalysisOrchestratorV2 for convenience
 */

export { AnalysisOrchestratorV2 as AnalysisOrchestrator } from './orchestrator-v2';
export type { AnalysisConfigV2 as AnalysisConfig } from './orchestrator-v2';

// For backward compatibility, also export the V2 class directly
export { AnalysisOrchestratorV2 } from './orchestrator-v2';