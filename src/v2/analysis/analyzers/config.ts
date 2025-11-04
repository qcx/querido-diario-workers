import type { AnalysisQueueHandlerEnv } from '../queue-handler';

export type AnalysisConfig = ReturnType<typeof getAnalysisConfig>;

/**
 * Get analysis configuration from environment
 */
export const getAnalysisConfig = (env: AnalysisQueueHandlerEnv) => {
  return {
    analyzers: {
      concurso: {
        enabled: true,
        priority: 1,  // Runs first
        timeout: 40000,  // Timeout for complete detection + classification pipeline
        detectionThreshold: 0.7,  // Minimum confidence to proceed with classification
        aiConfidenceThreshold: 0.7,  // Threshold for AI-assisted classification
        useAI: !!env.OPENAI_API_KEY,
        apiKey: env.OPENAI_API_KEY,
        model: 'gpt-4o-mini',
        temperature: 0.3,  // Low temperature for more deterministic results
        maxRetries: 2,  // Number of retries for AI API calls
        // Cost optimization settings
        hybridMode: true,  // Enable pattern+AI hybrid mode
        patternConfidenceThreshold: 0.7,  // Use pattern-only if confidence >= this
      },
      generic: {
        enabled: true,
        priority: 2,  // Runs after concurso
        timeout: 30000,  // Timeout for keyword detection + AI classification
        useAI: !!env.OPENAI_API_KEY,
        apiKey: env.OPENAI_API_KEY,
        model: 'gpt-4o-mini',
        temperature: 0.3,  // Low temperature for more deterministic results
        maxRetries: 2,  // Number of retries for AI API calls
        // Cost optimization settings
        patternConfidenceThreshold: 0.7,  // Use pattern-only if confidence >= this
      },
    },
    // Global cost optimization settings
    costOptimization: {
      enabled: true,  // Enable cost tracking and optimization
      maxCostPerGazette: 0.05,  // Maximum cost per gazette ($0.05)
      estimateBeforeCall: true,  // Estimate costs before making AI calls
      skipAIThreshold: 0.7,  // Skip AI if pattern confidence >= this threshold
      trackingEnabled: true,  // Track all AI usage and costs
      strictMode: false,  // If true, throw error when cost limit exceeded
    },
  };
}