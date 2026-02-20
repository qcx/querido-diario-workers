/**
 * Concurso Data Validator
 * Tests and validates the concurso data enrichment pipeline
 */

import { logger } from '../../utils';
import {
  DateValidator,
  MoneyValidator,
  CNPJValidator,
  TextNormalizer,
  ConcursoEnricher,
} from '../../services/concurso-enricher';
import {
  TerritoryNormalizer,
  ExternalDataEnricher,
} from '../../services/external-data-enricher';
import { ConcursoCalculator } from '../../services/concurso-calculator';

export interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  duration?: number;
}

export interface ValidationReport {
  totalTests: number;
  passed: number;
  failed: number;
  results: TestResult[];
  duration: number;
}

/**
 * Test suite for concurso data validation
 */
export class ConcursoDataValidator {
  /**
   * Run all validation tests
   */
  static async runAllTests(): Promise<ValidationReport> {
    const startTime = Date.now();
    const results: TestResult[] = [];

    // Date validation tests
    results.push(...this.testDateValidation());

    // Money validation tests
    results.push(...this.testMoneyValidation());

    // CNPJ validation tests
    results.push(...this.testCNPJValidation());

    // Text normalization tests
    results.push(...this.testTextNormalization());

    // Calculator tests
    results.push(...this.testCalculations());

    // Integration tests
    results.push(...await this.testIntegration());

    const duration = Date.now() - startTime;
    const passed = results.filter((r) => r.passed).length;
    const failed = results.filter((r) => r.passed === false).length;

    return {
      totalTests: results.length,
      passed,
      failed,
      results,
      duration,
    };
  }

  /**
   * Test date validation
   */
  private static testDateValidation(): TestResult[] {
    const tests: TestResult[] = [];

    // Test 1: Valid Brazilian date
    tests.push({
      name: 'DateValidator - Valid Brazilian date',
      passed: (() => {
        const result = DateValidator.normalize('15/03/2024');
        return result?.valid === true && result.normalized === '2024-03-15';
      })(),
      message: 'Should normalize Brazilian date format',
    });

    // Test 2: Invalid date
    tests.push({
      name: 'DateValidator - Invalid date',
      passed: (() => {
        const result = DateValidator.normalize('32/13/2024');
        return result?.valid === false;
      })(),
      message: 'Should detect invalid date',
    });

    // Test 3: Date range validation
    tests.push({
      name: 'DateValidator - Valid date range',
      passed: (() => {
        const result = DateValidator.validateRange('01/01/2024', '31/12/2024');
        return result.valid === true;
      })(),
      message: 'Should validate correct date range',
    });

    // Test 4: Invalid date range
    tests.push({
      name: 'DateValidator - Invalid date range',
      passed: (() => {
        const result = DateValidator.validateRange('31/12/2024', '01/01/2024');
        return result.valid === false;
      })(),
      message: 'Should detect inverted date range',
    });

    // Test 5: Future date detection
    tests.push({
      name: 'DateValidator - Future date detection',
      passed: (() => {
        const result = DateValidator.normalize('31/12/2099');
        return result?.valid === true && result.isFuture === true;
      })(),
      message: 'Should detect future dates',
    });

    return tests;
  }

  /**
   * Test money validation
   */
  private static testMoneyValidation(): TestResult[] {
    const tests: TestResult[] = [];

    // Test 1: Brazilian format with dots and comma
    tests.push({
      name: 'MoneyValidator - Brazilian format',
      passed: (() => {
        const result = MoneyValidator.normalize('R$ 3.500,00');
        return result?.valid === true && result.normalized === 3500;
      })(),
      message: 'Should parse Brazilian money format',
    });

    // Test 2: Simple number
    tests.push({
      name: 'MoneyValidator - Simple number',
      passed: (() => {
        const result = MoneyValidator.normalize('2500');
        return result?.valid === true && result.normalized === 2500;
      })(),
      message: 'Should parse simple number',
    });

    // Test 3: Number type input
    tests.push({
      name: 'MoneyValidator - Number input',
      passed: (() => {
        const result = MoneyValidator.normalize(4500.50);
        return result?.valid === true && result.normalized === 4500.50;
      })(),
      message: 'Should handle number input',
    });

    // Test 4: Value validation - below minimum
    tests.push({
      name: 'MoneyValidator - Below minimum warning',
      passed: (() => {
        const result = MoneyValidator.normalize('1000');
        return result?.warnings && result.warnings.length > 0;
      })(),
      message: 'Should warn about values below minimum wage',
    });

    // Test 5: Formatted output
    tests.push({
      name: 'MoneyValidator - Formatted output',
      passed: (() => {
        const result = MoneyValidator.normalize('5000');
        return result?.formatted.includes('5.000,00');
      })(),
      message: 'Should format money values correctly',
    });

    return tests;
  }

  /**
   * Test CNPJ validation
   */
  private static testCNPJValidation(): TestResult[] {
    const tests: TestResult[] = [];

    // Test 1: Valid CNPJ format
    tests.push({
      name: 'CNPJValidator - Valid format',
      passed: (() => {
        const result = CNPJValidator.normalize('00.000.000/0001-91');
        return result?.normalized === '00.000.000/0001-91';
      })(),
      message: 'Should normalize valid CNPJ format',
    });

    // Test 2: CNPJ without formatting
    tests.push({
      name: 'CNPJValidator - Digits only',
      passed: (() => {
        const result = CNPJValidator.normalize('00000000000191');
        return result?.normalized === '00.000.000/0001-91';
      })(),
      message: 'Should format CNPJ from digits',
    });

    // Test 3: Invalid length
    tests.push({
      name: 'CNPJValidator - Invalid length',
      passed: (() => {
        const result = CNPJValidator.normalize('123456');
        return result?.valid === false;
      })(),
      message: 'Should reject invalid CNPJ length',
    });

    // Test 4: Real valid CNPJ
    tests.push({
      name: 'CNPJValidator - Real CNPJ validation',
      passed: (() => {
        // Fundação Getulio Vargas CNPJ
        const result = CNPJValidator.normalize('33.641.663/0001-44');
        return result?.valid === true;
      })(),
      message: 'Should validate real CNPJ check digits',
    });

    return tests;
  }

  /**
   * Test text normalization
   */
  private static testTextNormalization(): TestResult[] {
    const tests: TestResult[] = [];

    // Test 1: Remove excessive whitespace
    tests.push({
      name: 'TextNormalizer - Whitespace removal',
      passed: (() => {
        const result = TextNormalizer.normalize('Test   with   extra   spaces');
        return result?.normalized === 'Test with extra spaces';
      })(),
      message: 'Should remove excessive whitespace',
    });

    // Test 2: Normalize organization name
    tests.push({
      name: 'TextNormalizer - Organization name',
      passed: (() => {
        const result = TextNormalizer.normalizeOrgaoName('PREF. MUN. DE SÃO PAULO');
        return result?.includes('Prefeitura') && result?.includes('Municipal');
      })(),
      message: 'Should normalize organization abbreviations',
    });

    // Test 3: Normalize cargo name
    tests.push({
      name: 'TextNormalizer - Cargo name',
      passed: (() => {
        const result = TextNormalizer.normalizeCargoName('professor de MATEMÁTICA');
        return result === 'Professor De Matemática';
      })(),
      message: 'Should capitalize cargo names correctly',
    });

    // Test 4: Encoding fixes
    tests.push({
      name: 'TextNormalizer - Encoding fixes',
      passed: (() => {
        const result = TextNormalizer.normalize('InformaÃ§Ã£o');
        return result?.normalized === 'Informação';
      })(),
      message: 'Should fix encoding issues',
    });

    return tests;
  }

  /**
   * Test calculator functions
   */
  private static testCalculations(): TestResult[] {
    const tests: TestResult[] = [];

    // Test 1: Calculate total vagas
    tests.push({
      name: 'Calculator - Total vagas',
      passed: (() => {
        const data = {
          vagas: {
            total: 10,
            porCargo: [
              { cargo: 'Professor', vagas: 5 },
              { cargo: 'Auxiliar', vagas: 5 },
            ],
          },
        };
        const result = ConcursoCalculator.calculateTotalVagas(data);
        return result.totalCalculado === 10 && result.discrepancia === false;
      })(),
      message: 'Should calculate total vacancies correctly',
    });

    // Test 2: Detect discrepancy
    tests.push({
      name: 'Calculator - Discrepancy detection',
      passed: (() => {
        const data = {
          vagas: {
            total: 15,
            porCargo: [
              { cargo: 'Professor', vagas: 5 },
              { cargo: 'Auxiliar', vagas: 5 },
            ],
          },
        };
        const result = ConcursoCalculator.calculateTotalVagas(data);
        return result.discrepancia === true;
      })(),
      message: 'Should detect vacancy discrepancies',
    });

    // Test 3: Calculate prazos
    tests.push({
      name: 'Calculator - Prazos calculation',
      passed: (() => {
        const data = {
          datas: {
            inscricoesInicio: '01/01/2024',
            inscricoesFim: '31/01/2024',
          },
        };
        const result = ConcursoCalculator.calculatePrazos(data);
        return result.periodoInscricaoDias === 30;
      })(),
      message: 'Should calculate inscription period',
    });

    // Test 4: Infer status - open
    tests.push({
      name: 'Calculator - Status inference (open)',
      passed: (() => {
        const data = {
          documentType: 'edital_abertura',
          datas: {
            inscricoesFim: '31/12/2099', // Far future
          },
        };
        const prazos = ConcursoCalculator.calculatePrazos(data);
        const status = ConcursoCalculator.inferStatus(data, prazos);
        return status.status === 'aberto';
      })(),
      message: 'Should infer open status correctly',
    });

    // Test 5: Calculate taxa stats
    tests.push({
      name: 'Calculator - Taxa statistics',
      passed: (() => {
        const data = {
          taxas: [
            { valor: 50 },
            { valor: 100 },
            { valor: 150 },
          ],
        };
        const result = ConcursoCalculator.calculateTaxaStats(data);
        return result.media === 100 && result.minima === 50 && result.maxima === 150;
      })(),
      message: 'Should calculate fee statistics',
    });

    // Test 6: Data quality calculation
    tests.push({
      name: 'Calculator - Data quality',
      passed: (() => {
        const data = {
          orgao: 'Prefeitura Test',
          editalNumero: '001/2024',
          vagas: { total: 10 },
          datas: {
            inscricoesInicio: '01/01/2024',
            inscricoesFim: '31/01/2024',
          },
        };
        const result = ConcursoCalculator.calculateDataQuality(data);
        return result.completeness > 0.5 && result.validatedFields.length > 0;
      })(),
      message: 'Should calculate data quality metrics',
    });

    return tests;
  }

  /**
   * Test integration with full enrichment pipeline
   */
  private static async testIntegration(): Promise<TestResult[]> {
    const tests: TestResult[] = [];

    // Test 1: Full enrichment pipeline
    tests.push({
      name: 'Integration - Full enrichment',
      passed: await (async () => {
        try {
          const rawData = {
            documentType: 'edital_abertura',
            orgao: 'PREF MUN DE SÃO PAULO',
            editalNumero: '001/2024',
            vagas: {
              total: 10,
              porCargo: [
                {
                  cargo: 'professor',
                  vagas: 5,
                  salario: 'R$ 3.500,00',
                },
                {
                  cargo: 'auxiliar',
                  vagas: 5,
                  salario: '2500',
                },
              ],
            },
            datas: {
              inscricoesInicio: '01/01/2024',
              inscricoesFim: '31/01/2024',
              prova: '15/02/2024',
            },
            taxas: [{ valor: 'R$ 50,00' }],
            banca: {
              nome: 'FGV',
              cnpj: '33.641.663/0001-44',
            },
          };

          // Apply enrichment
          let enriched = ConcursoEnricher.enrichConcursoData(rawData);
          enriched = await ExternalDataEnricher.enrichConcursoData(enriched);
          enriched = ConcursoCalculator.enrichWithCalculations(enriched);

          // Verify enrichment
          const hasEnrichment = enriched._enrichment !== undefined;
          const hasCalculations = enriched._calculations !== undefined;
          const hasQuality = enriched._dataQuality !== undefined;
          const datesNormalized = enriched.datas?.inscricoesInicio === '2024-01-01';

          return hasEnrichment && hasCalculations && hasQuality && datesNormalized;
        } catch (error) {
          logger.error('Integration test failed', error as Error);
          return false;
        }
      })(),
      message: 'Should enrich data through full pipeline',
    });

    // Test 2: Enrichment with missing data
    tests.push({
      name: 'Integration - Partial data enrichment',
      passed: await (async () => {
        try {
          const rawData = {
            documentType: 'edital_retificacao',
            orgao: 'Test Organization',
          };

          let enriched = ConcursoEnricher.enrichConcursoData(rawData);
          enriched = ConcursoCalculator.enrichWithCalculations(enriched);

          // Should still produce quality metrics with warnings
          return (
            enriched._dataQuality !== undefined &&
            enriched._dataQuality.completeness < 0.5
          );
        } catch (error) {
          logger.error('Partial data test failed', error as Error);
          return false;
        }
      })(),
      message: 'Should handle partial data gracefully',
    });

    return tests;
  }

  /**
   * Validate webhook output format
   */
  static validateWebhookOutput(concursoData: any): ValidationReport {
    const startTime = Date.now();
    const results: TestResult[] = [];

    // Check required fields
    results.push({
      name: 'Webhook - Required fields present',
      passed: !!(concursoData.documentType && concursoData.orgao),
      message: 'Should have required fields',
    });

    // Check enrichment metadata
    results.push({
      name: 'Webhook - Enrichment metadata',
      passed: !!(
        concursoData._enrichment ||
        concursoData._calculations ||
        concursoData._dataQuality
      ),
      message: 'Should have enrichment metadata',
    });

    // Check date normalization
    results.push({
      name: 'Webhook - Date normalization',
      passed: (() => {
        if (!concursoData.datas) return true; // No dates to validate
        const datePattern = /^\d{4}-\d{2}-\d{2}$/;
        for (const key of Object.keys(concursoData.datas)) {
          if (!key.includes('_enriched')) {
            const value = concursoData.datas[key];
            if (value && !datePattern.test(value)) {
              return false;
            }
          }
        }
        return true;
      })(),
      message: 'Should have normalized dates',
    });

    // Check salary normalization
    results.push({
      name: 'Webhook - Salary normalization',
      passed: (() => {
        if (!concursoData.vagas?.porCargo) return true;
        for (const cargo of concursoData.vagas.porCargo) {
          if (cargo.salario && typeof cargo.salario !== 'number') {
            return false;
          }
        }
        return true;
      })(),
      message: 'Should have normalized salary values',
    });

    const duration = Date.now() - startTime;
    const passed = results.filter((r) => r.passed).length;

    return {
      totalTests: results.length,
      passed,
      failed: results.length - passed,
      results,
      duration,
    };
  }

  /**
   * Print validation report
   */
  static printReport(report: ValidationReport): void {
    console.log('\n' + '='.repeat(60));
    console.log('CONCURSO DATA VALIDATION REPORT');
    console.log('='.repeat(60));
    console.log(`Total Tests: ${report.totalTests}`);
    console.log(`Passed: ${report.passed} ✓`);
    console.log(`Failed: ${report.failed} ✗`);
    console.log(`Duration: ${report.duration}ms`);
    console.log('='.repeat(60));

    if (report.failed > 0) {
      console.log('\nFailed Tests:');
      for (const result of report.results.filter((r) => !r.passed)) {
        console.log(`  ✗ ${result.name}`);
        console.log(`    ${result.message}`);
      }
    }

    console.log('\nAll Tests:');
    for (const result of report.results) {
      const icon = result.passed ? '✓' : '✗';
      console.log(`  ${icon} ${result.name}`);
    }

    console.log('\n' + '='.repeat(60) + '\n');
  }
}

