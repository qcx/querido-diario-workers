# V2 Analysis Flow Documentation

## Overview

The V2 Analysis System implements a smart routing approach for analyzing gazette content based on concurso-related keywords. This system replaces the previous section-title-based approach with a more targeted content analysis flow.

## Analysis Flow

The V2 system follows a three-tier routing strategy:

```
Text Input
    ↓
┌─────────────────────────────────────┐
│ 1. Direct Concurso Detection        │
│ Keywords: "concurso público",       │
│          "concursos públicos"       │
└─────────────────────────────────────┘
    ↓ Found?
    ├─ YES → ConcursoAnalyzerV2
    └─ NO ↓
┌─────────────────────────────────────┐
│ 2. Ambiguous Terms Detection        │
│ Keywords: "processo seletivo",      │
│          "processo de seleção",     │
│          "concurso" (without público)│
└─────────────────────────────────────┘
    ↓ Found?
    ├─ YES → AIConcursoValidator
    │         ↓ AI Decision
    │         ├─ Valid → ConcursoAnalyzerV2
    │         └─ Invalid → GeneralAnalyzerV2
    └─ NO ↓
┌─────────────────────────────────────┐
│ 3. General Content                  │
│ No concurso keywords found          │
└─────────────────────────────────────┘
    ↓
    GeneralAnalyzerV2
```

## Components

### 1. ConcursoAnalyzerV2
- **Purpose**: Handles content with direct concurso público keywords
- **Triggers**: "concurso público", "concursos públicos", "concurso publico"
- **Features**:
  - Document type classification (edital_abertura, convocacao, homologacao, etc.)
  - Structured data extraction (edital number, cargo, vagas, salário, etc.)
  - Pattern-based analysis using duplicated V1 rules
  - High confidence findings for webhook routing

### 2. AIConcursoValidator
- **Purpose**: Validates ambiguous concurso terms using AI/heuristics
- **Triggers**: "processo seletivo", "processo de seleção", "concurso" (without público)
- **Features**:
  - Heuristic-based validation (placeholder for AI integration)
  - Context analysis around ambiguous terms
  - Positive/negative indicator scoring
  - Routes to concurso analyzer if validated, general analyzer if rejected

### 3. GeneralAnalyzerV2
- **Purpose**: Processes non-concurso content
- **Triggers**: No concurso-related keywords found
- **Features**:
  - Administrative acts detection (decreto, portaria, resolução)
  - Budget and finance content
  - Public procurement (licitação, pregão)
  - Appointments and nominations
  - Public health, education, urban planning content

## Configuration

### Basic V2 Configuration

```typescript
const config: AnalysisConfigV2 = {
  analyzers: {
    concurso: { enabled: true, priority: 1.5, timeout: 180000 },
    // Other V1 analyzers...
  },
  analyzersV2: {
    concurso: {
      enabled: true,
      useAIExtraction: false, // Future feature
    },
    aiValidator: {
      enabled: true,
      aiTimeout: 30000,
      maxTextLength: 4000,
    },
    general: {
      enabled: true,
      enableKeywordDetection: true,
      enableEntityExtraction: false, // Future feature
    },
  },
};
```

### Advanced Configuration

```typescript
const advancedConfig: AnalysisConfigV2 = {
  analyzers: {
    concurso: { 
      enabled: true, 
      priority: 1.5, 
      timeout: 180000,
      useAIExtraction: true, // Enable AI enhancement
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-mini',
    },
  },
  analyzersV2: {
    concurso: {
      enabled: true,
      useAIExtraction: true,
      apiKey: process.env.OPENAI_API_KEY,
    },
    aiValidator: {
      enabled: true,
      apiKey: process.env.OPENAI_API_KEY,
      model: 'gpt-4o-mini',
      aiTimeout: 30000,
    },
    general: {
      enabled: true,
      enableKeywordDetection: true,
      enableEntityExtraction: true,
      minConfidenceThreshold: 0.6,
    },
  },
};
```

## Usage

### Basic Usage

```typescript
import { AnalysisOrchestratorV2, AnalysisConfigV2 } from './analyzers/v2';

// Create orchestrator
const orchestrator = new AnalysisOrchestratorV2(config);

// Analyze content (same interface as V1)
const result = await orchestrator.analyze(ocrResult, territoryId, jobId);
```

### Integration with Analysis Processor

```typescript
// In goodfellow/analysis-processor.ts
import { AnalysisOrchestratorV2 } from '../analyzers/v2';

function getAnalysisConfig(env: AnalysisProcessorEnv): AnalysisConfigV2 {
  return {
    analyzers: {
      keyword: { enabled: true, priority: 1, timeout: 20000 },
      concurso: { enabled: true, priority: 1.5, timeout: 180000 },
      // ... other analyzers
    },
    analyzersV2: {
      concurso: { enabled: true },
      aiValidator: { enabled: true, apiKey: env.OPENAI_API_KEY },
      general: { enabled: true },
    },
  };
}

// Use V2 orchestrator
const orchestrator = new AnalysisOrchestratorV2(config);
```

## Routing Examples

### Example 1: Direct Concurso Público
**Input**: "EDITAL DE ABERTURA DE CONCURSO PÚBLICO Nº 001/2024..."
**Route**: `concurso`
**Analyzer**: `ConcursoAnalyzerV2`
**Result**: Structured concurso data with document type classification

### Example 2: Processo Seletivo
**Input**: "PROCESSO SELETIVO PARA CONTRATAÇÃO TEMPORÁRIA..."
**Route**: `ai-validation`
**Analyzer**: `AIConcursoValidator` → (if valid) → `ConcursoAnalyzerV2`
**Result**: AI validation result, potentially routed to concurso analysis

### Example 3: General Administrative
**Input**: "DECRETO Nº 123/2024 - Dispõe sobre reorganização..."
**Route**: `general`
**Analyzer**: `GeneralAnalyzerV2`
**Result**: Administrative act classification and general content analysis

### Example 4: Ambiguous Concurso
**Input**: "CONCURSO CULTURAL DE FOTOGRAFIA 2024..."
**Route**: `ai-validation`
**Analyzer**: `AIConcursoValidator` → `GeneralAnalyzerV2`
**Result**: Rejected as non-public concurso, processed as general content

## Migration from V1

The V2 system is designed as a drop-in replacement for V1:

1. **Same Interface**: `analyze()` method signature unchanged
2. **Same Output**: Compatible `GazetteAnalysis` format
3. **Enhanced Metadata**: Additional V2-specific routing information
4. **Backward Compatibility**: Works with existing webhook and database schemas

### Migration Steps

1. Update imports:
   ```typescript
   // Before
   import { AnalysisOrchestrator } from './services/analysis-orchestrator';
   
   // After
   import { AnalysisOrchestratorV2 } from './analyzers/v2';
   ```

2. Update configuration:
   ```typescript
   // Add V2-specific config
   const config: AnalysisConfigV2 = {
     ...existingV1Config,
     analyzersV2: {
       concurso: { enabled: true },
       aiValidator: { enabled: true },
       general: { enabled: true },
     },
   };
   ```

3. Replace orchestrator instantiation:
   ```typescript
   const orchestrator = new AnalysisOrchestratorV2(config);
   ```

## Performance Benefits

- **Targeted Analysis**: Only runs relevant analyzers based on content type
- **Reduced Processing**: Avoids running all analyzers on every document
- **Smart Routing**: Eliminates unnecessary AI calls for clear cases
- **Pattern Reuse**: Leverages proven V1 concurso patterns

## Future Enhancements

1. **Full AI Integration**: Replace heuristic validation with OpenAI API
2. **Enhanced Entity Extraction**: Add NER for general content
3. **Caching**: Cache routing decisions for similar content
4. **Performance Metrics**: Built-in performance monitoring
5. **Advanced Patterns**: Machine learning-based pattern detection

## Testing

Run the V2 flow test:

```bash
cd src/analyzers/v2
npx ts-node test-v2-flow.ts
```

This will test all routing scenarios and verify the analysis flow works correctly.

## Removed Components

- **SectionTitleFinder**: Removed as requested, no longer part of V2 system
- **Section-based routing**: Replaced with keyword-based routing
- **Complex section parsing**: Simplified to direct content analysis

## Troubleshooting

### Common Issues

1. **No findings generated**: Check if content matches any routing criteria
2. **Wrong analyzer selected**: Verify keyword detection functions
3. **AI validation fails**: Ensure API key is configured (falls back to heuristics)
4. **Performance issues**: Check analyzer timeouts and text length limits

### Debug Information

The V2 system provides enhanced logging:
- Routing decisions with reasons
- Selected analyzers for each route
- Processing time per analyzer
- Validation results and confidence scores



