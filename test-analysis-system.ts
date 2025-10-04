/**
 * Test Analysis System
 */

import { OcrResult, AnalysisConfig } from './src/types';
import { AnalysisOrchestrator } from './src/services/analysis-orchestrator';

async function testAnalysisSystem() {
  console.log('🔬 Testing Analysis System\n');
  console.log('='.repeat(80));

  // Create mock OCR result
  const mockOcrResult: OcrResult = {
    jobId: 'test-ocr-job-123',
    status: 'success',
    pdfUrl: 'https://example.com/gazette.pdf',
    territoryId: '3550308',
    publicationDate: '2025-10-04',
    extractedText: `
PREFEITURA MUNICIPAL DE SÃO PAULO
DIÁRIO OFICIAL DO MUNICÍPIO

Data: 04 de outubro de 2025
Edição nº 1234

CONCURSO PÚBLICO

A Prefeitura Municipal de São Paulo torna público que estarão abertas as inscrições
para o Concurso Público destinado ao provimento de 100 (cem) vagas para o cargo
de Analista de Sistemas.

Período de inscrições: 10/10/2025 a 30/10/2025
Valor da inscrição: R$ 120,00
Salário: R$ 8.500,00

LICITAÇÃO

Pregão Eletrônico nº 456/2025
Objeto: Aquisição de equipamentos de informática
Valor estimado: R$ 1.500.000,00
Data de abertura: 15/10/2025

NOMEAÇÃO

O Prefeito Municipal, no uso de suas atribuições legais, NOMEIA, nos termos do
Decreto nº 12.345/2024, o Sr. João Silva Santos, CPF 123.456.789-00, para exercer
o cargo de Diretor do Departamento de Tecnologia da Informação.

CONTRATO

Termo de Contrato nº 789/2025
Contratada: Tech Solutions Ltda, CNPJ 12.345.678/0001-90
Objeto: Prestação de serviços de manutenção de sistemas
Valor: R$ 250.000,00
Vigência: 12 meses

Fundamentação Legal: Lei Municipal nº 16.050/2015
    `.trim(),
    processingTimeMs: 2500,
    spiderId: 'sp_sao_paulo',
    editionNumber: '1234',
    metadata: {
      power: 'executive',
      isExtraEdition: false,
    },
  };

  // Create analysis configuration
  const config: AnalysisConfig = {
    analyzers: {
      keyword: {
        enabled: true,
        priority: 1,
        timeout: 10000,
      },
      entity: {
        enabled: true,
        priority: 2,
        timeout: 15000,
      },
      ai: {
        enabled: false, // Disabled for local testing
        priority: 3,
        timeout: 30000,
      },
    },
  };

  console.log('\n📋 Configuration:');
  console.log(JSON.stringify(config, null, 2));

  console.log('\n📄 OCR Result:');
  console.log(`  Job ID: ${mockOcrResult.jobId}`);
  console.log(`  Territory: ${mockOcrResult.territoryId}`);
  console.log(`  Date: ${mockOcrResult.publicationDate}`);
  console.log(`  Text Length: ${mockOcrResult.extractedText.length} chars`);

  console.log('\n🔍 Running Analysis...\n');
  console.log('='.repeat(80));

  const orchestrator = new AnalysisOrchestrator(config);
  const startTime = Date.now();
  const analysis = await orchestrator.analyze(mockOcrResult);
  const totalTime = Date.now() - startTime;

  console.log('\n✅ Analysis Complete!\n');
  console.log('='.repeat(80));

  console.log('\n📊 Summary:');
  console.log(`  Total Findings: ${analysis.summary.totalFindings}`);
  console.log(`  High Confidence: ${analysis.summary.highConfidenceFindings}`);
  console.log(`  Categories: ${analysis.summary.categories.join(', ')}`);
  console.log(`  Top Keywords: ${analysis.summary.keywords.slice(0, 10).join(', ')}`);
  console.log(`  Processing Time: ${totalTime}ms`);

  console.log('\n🔬 Analysis Results by Analyzer:\n');

  for (const result of analysis.analyses) {
    console.log(`\n  ${result.analyzerId} (${result.analyzerType})`);
    console.log(`  ${'─'.repeat(70)}`);
    console.log(`  Status: ${result.status}`);
    console.log(`  Findings: ${result.findings.length}`);
    console.log(`  Time: ${result.processingTimeMs}ms`);

    if (result.status === 'success' && result.findings.length > 0) {
      console.log(`\n  Top Findings:`);
      
      const topFindings = result.findings
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5);

      for (const finding of topFindings) {
        console.log(`    • ${finding.type}`);
        console.log(`      Confidence: ${(finding.confidence * 100).toFixed(1)}%`);
        console.log(`      Data: ${JSON.stringify(finding.data)}`);
        if (finding.context) {
          console.log(`      Context: "${finding.context.substring(0, 80)}..."`);
        }
      }
    }

    if (result.metadata) {
      console.log(`\n  Metadata: ${JSON.stringify(result.metadata, null, 4)}`);
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n📈 Findings by Type:\n');

  const findingsByType = analysis.summary.findingsByType;
  const sortedTypes = Object.entries(findingsByType)
    .sort((a, b) => b[1] - a[1]);

  for (const [type, count] of sortedTypes) {
    console.log(`  ${type.padEnd(40)} ${count}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n💾 Full Analysis Object:\n');
  console.log(JSON.stringify(analysis, null, 2));

  console.log('\n' + '='.repeat(80));
  console.log('\n✅ Test completed successfully!\n');
}

testAnalysisSystem()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    console.error(error.stack);
    process.exit(1);
  });
