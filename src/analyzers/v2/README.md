# V2 Analyzer System

The V2 Analyzer System is an enhanced version of the original analyzer framework with section-based processing, header/footer extraction, and improved context awareness.

## Key Features

### 🔍 Section-Based Analysis
- Parses markdown sections (# ## ###) from Mistral OCR output
- Analyzes content within section boundaries
- Maintains section context in findings
- Supports section-level relevance scoring

### 🧹 Text Preprocessing
- Removes repetitive headers and footers from gazette pages
- Normalizes text for better analysis
- Configurable extraction rules
- Significant text reduction for improved performance

### 📊 Enhanced Context Extraction
- Section-aware context extraction
- Improved keyword matching with section relevance
- Enhanced confidence scoring based on section context
- Support for section hierarchy in analysis

### 🔄 Backward Compatibility
- Same contract as original `AnalysisOrchestrator`
- Compatible `AnalysisResult` and `GazetteAnalysis` outputs
- Seamless integration with existing `goodfellow/analysis-processor.ts`

## Architecture

```
V2 Analyzer System
├── TextPreprocessor          # Header/footer extraction & section parsing
├── BaseAnalyzerV2           # Enhanced base class with section awareness
├── KeywordAnalyzerV2        # Section-aware keyword analysis
└── AnalysisOrchestratorV2   # Main orchestrator with same contract
```

## Usage

### Basic Usage

```typescript
import { AnalysisOrchestratorV2, AnalysisConfigV2 } from './analyzers/v2';

// Create V2 configuration
const config: AnalysisConfigV2 = {
  analyzers: {
    keyword: {
      enabled: true,
      priority: 1,
      timeout: 20000,
    },
  },
  preprocessor: {
    removeHeadersFooters: true,
    parseSections: true,
    minSectionLength: 50,
  },
  analyzersV2: {
    keyword: {
      useSectionRelevance: true,
      contextRadius: 300,
      includeSectionHierarchy: true,
    },
  },
};

// Create orchestrator
const orchestrator = new AnalysisOrchestratorV2(config);

// Analyze (same interface as V1)
const result = await orchestrator.analyze(ocrResult, territoryId, jobId);
```

### Advanced Configuration

```typescript
// Custom preprocessing configuration
const preprocessorConfig: PreprocessorConfig = {
  removeHeadersFooters: true,
  parseSections: true,
  minSectionLength: 100,
  repetitionThreshold: 2, // Lower threshold for header detection
};

// Custom keyword patterns with section targeting
const keywordPatterns: KeywordPatternV2[] = [
  {
    category: 'concurso_publico',
    keywords: ['concurso público', 'concurso publico'],
    targetSectionTitles: [/concurso/i, /edital/i],
    targetSectionLevels: [1, 2, 3],
    sectionRelevanceMultiplier: 0.3,
    weight: 0.95,
  },
];
```

## Components

### TextPreprocessor

Handles text cleaning and section parsing:

```typescript
const preprocessor = new TextPreprocessor({
  removeHeadersFooters: true,
  parseSections: true,
  minSectionLength: 50,
});

const result = await preprocessor.preprocess(text);
// result.cleanedText - text with headers/footers removed
// result.sections - parsed markdown sections
```

### BaseAnalyzerV2

Enhanced base class for V2 analyzers:

```typescript
class MyAnalyzerV2 extends BaseAnalyzerV2 {
  constructor(config: AnalyzerV2Config) {
    super('my-analyzer-v2', 'custom', config);
  }

  protected async performSectionAnalysis(
    ocrResult: OcrResult, 
    section: ParsedSection
  ): Promise<Finding[]> {
    // Analyze specific section
    return findings;
  }
}
```

### KeywordAnalyzerV2

Section-aware keyword analysis:

```typescript
const analyzer = new KeywordAnalyzerV2({
  patterns: keywordPatterns,
  useSectionRelevance: true,
  contextRadius: 300,
});
```

## Migration from V1

The V2 system is designed to be a drop-in replacement:

```typescript
// V1 usage
import { AnalysisOrchestrator } from './services/analysis-orchestrator';
const orchestrator = new AnalysisOrchestrator(config);

// V2 usage (same interface)
import { AnalysisOrchestratorV2 } from './analyzers/v2';
const orchestrator = new AnalysisOrchestratorV2(configV2);
```

## Performance Benefits

- **Text Reduction**: 30-70% reduction in text size through header/footer removal
- **Targeted Analysis**: Section-based analysis focuses on relevant content
- **Improved Accuracy**: Section context improves keyword matching confidence
- **Better Context**: Enhanced context extraction with section hierarchy

## Configuration Options

### Preprocessor Configuration

```typescript
interface PreprocessorConfig {
  removeHeadersFooters: boolean;    // Enable header/footer removal
  parseSections: boolean;           // Enable section parsing
  minSectionLength: number;         // Minimum section content length
  repetitionThreshold: number;      // Header/footer repetition threshold
}
```

### V2 Analyzer Configuration

```typescript
interface AnalyzerV2Config extends AnalyzerConfig {
  preprocessor?: Partial<PreprocessorConfig>;
  useSectionAnalysis?: boolean;     // Enable section-based analysis
  minSectionRelevance?: number;     // Minimum section relevance score
}
```

## Section-Aware Findings

V2 findings include enhanced section context:

```typescript
interface SectionAwareFinding extends Finding {
  section?: {
    title: string;              // Section title
    level: number;              // Section level (1-6)
    normalizedTitle: string;    // Normalized title for matching
  };
  sectionPosition?: number;     // Position within section
  sectionRelevance?: number;    // Section relevance score (0-1)
}
```

## Integration with Existing System

The V2 system integrates seamlessly with the existing analysis processor:

```typescript
// In goodfellow/analysis-processor.ts
import { AnalysisOrchestratorV2 } from '../analyzers/v2';

// Use V2 orchestrator instead of V1
const orchestrator = new AnalysisOrchestratorV2(config);
const result = await orchestrator.analyze(ocrResult, territoryId, jobId);
// Same result format as V1
```

## Future Enhancements

- **AI Analyzer V2**: Section-aware AI analysis
- **Entity Extractor V2**: Enhanced entity extraction with section context
- **Performance Monitoring**: Built-in performance metrics and monitoring
- **Advanced Section Parsing**: Support for complex document structures
- **Caching**: Preprocessing result caching for improved performance
