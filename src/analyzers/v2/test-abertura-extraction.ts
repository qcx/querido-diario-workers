/**
 * Test script for validating abertura extraction improvements
 * 
 * This script tests the extraction of:
 * - Cargos with "CR" (Cadastro Reserva) values from tables
 * - Complete date schedules from chronogram tables
 */

import * as fs from 'fs';
import * as path from 'path';
import { AberturaExtractorService } from './abertura-extractor';
import { OcrResult, Finding } from '../../types';

// Mock finding data
const mockFinding: Finding = {
  type: 'keyword',
  keyword: 'concurso_abertura',
  confidence: 0.95,
  context: '...o, constantes do presente edital.\n' +
    '4.2- As inscrições serão feitas exclusivamente via internet, no site www.consesp.com.br, no período de 05 a 23 de novembro de 2025, (horário de Brasília), devendo, para tanto, o interessado proceder da seguinte forma:\n' +
    'a) acesse o site www.consesp.com.br e clique em Concursos, inscrições abertas, sobre a cidade que deseja se inscrever.\n' +
    'b) em seguida, clique em INSCREVA-SE, digite o número de seu CPF, leia e aceite os termos e condições e clique em continuar;\n' +
    'c) digite corretamente o CEP de seu endereço, escolha a Função para o qual deseja se inscrever, clique e...',
  data: {
    position: 1000,
  },
};

async function runTest() {
  console.log('='.repeat(80));
  console.log('Testing Abertura Extraction Improvements');
  console.log('='.repeat(80));
  console.log();

  // Read test.md file
  const testFilePath = path.join(__dirname, 'test.md');
  const testContent = fs.readFileSync(testFilePath, 'utf-8');

  // Create mock OCR result
  const ocrResult: OcrResult = {
    jobId: 'test-job-123',
    gazetteId: 'test-gazette-456',
    extractedText: testContent,
    status: 'completed',
  };

  // Initialize extractor (without API key for pattern-only testing)
  const extractor = new AberturaExtractorService({
    apiKey: '', // Empty API key - will only use pattern extraction
    enabled: true,
  });

  console.log('Processing abertura findings...\n');

  // Process the findings
  const result = await extractor.processAberturaFindings(ocrResult, [mockFinding]);

  if (!result) {
    console.error('❌ Extraction failed - returned null');
    return;
  }

  console.log('✅ Extraction completed successfully!\n');
  console.log('='.repeat(80));
  console.log('EXTRACTION RESULTS:');
  console.log('='.repeat(80));
  console.log();

  const concursoData = result.data.concursoData;

  // Check organization
  console.log('📋 Organization (Órgão):');
  console.log(`   ${concursoData?.orgao || '❌ Not found'}`);
  console.log();

  // Check edital number
  console.log('📄 Edital Number:');
  console.log(`   ${concursoData?.editalNumero || '❌ Not found'}`);
  console.log();

  // Check vagas (positions)
  console.log('👥 Vagas (Positions):');
  if (concursoData?.vagas?.porCargo && concursoData.vagas.porCargo.length > 0) {
    console.log(`   ✅ Found ${concursoData.vagas.porCargo.length} positions`);
    console.log();
    console.log('   Sample positions:');
    concursoData.vagas.porCargo.slice(0, 3).forEach(cargo => {
      console.log(`   - ${cargo.cargo}: ${cargo.vagas} vagas, R$ ${cargo.salario || 'N/A'}`);
    });
    if (concursoData.vagas.porCargo.length > 3) {
      console.log(`   ... and ${concursoData.vagas.porCargo.length - 3} more`);
    }
    
    // Check for CR values
    const crPositions = concursoData.vagas.porCargo.filter(c => c.vagas === 'CR');
    if (crPositions.length > 0) {
      console.log(`   ✅ Found ${crPositions.length} positions with "CR" (Cadastro Reserva)`);
    } else {
      console.log('   ⚠️  No "CR" positions found (expected from test data)');
    }
  } else {
    console.log('   ❌ No positions extracted');
  }
  console.log();

  // Check dates
  console.log('📅 Important Dates:');
  if (concursoData?.datas) {
    const dates = concursoData.datas;
    console.log(`   Inscrições Início: ${dates.inscricoesInicio || '❌'}`);
    console.log(`   Inscrições Fim: ${dates.inscricoesFim || '❌'}`);
    console.log(`   Prova: ${dates.prova || '❌'}`);
    console.log(`   Prova Objetiva: ${dates.provaObjetiva || '❌'}`);
    console.log(`   Resultado: ${dates.resultado || '❌'}`);
    
    const dateCount = Object.keys(dates).length;
    if (dateCount >= 4) {
      console.log(`   ✅ Extracted ${dateCount} dates (good coverage)`);
    } else if (dateCount >= 2) {
      console.log(`   ⚠️  Extracted ${dateCount} dates (partial coverage)`);
    } else {
      console.log(`   ❌ Only ${dateCount} dates extracted (poor coverage)`);
    }
  } else {
    console.log('   ❌ No dates extracted');
  }
  console.log();

  // Check banca
  console.log('🏢 Banca Organizadora:');
  if (concursoData?.banca) {
    console.log(`   Nome: ${concursoData.banca.nome || 'N/A'}`);
    console.log(`   CNPJ: ${concursoData.banca.cnpj || 'N/A'}`);
  } else {
    console.log('   ❌ Not found');
  }
  console.log();

  // Summary
  console.log('='.repeat(80));
  console.log('VALIDATION SUMMARY:');
  console.log('='.repeat(80));
  
  const checks = [
    { name: 'Organization extracted', passed: !!concursoData?.orgao },
    { name: 'Edital number extracted', passed: !!concursoData?.editalNumero },
    { name: 'Positions extracted', passed: (concursoData?.vagas?.porCargo?.length || 0) > 0 },
    { name: 'CR values handled', passed: concursoData?.vagas?.porCargo?.some(c => c.vagas === 'CR') || false },
    { name: 'Multiple dates extracted', passed: Object.keys(concursoData?.datas || {}).length >= 3 },
    { name: 'Banca extracted', passed: !!concursoData?.banca?.nome },
  ];

  checks.forEach(check => {
    const icon = check.passed ? '✅' : '❌';
    console.log(`${icon} ${check.name}`);
  });

  const passedCount = checks.filter(c => c.passed).length;
  const totalCount = checks.length;
  console.log();
  console.log(`Score: ${passedCount}/${totalCount} checks passed`);
  console.log('='.repeat(80));

  // Full data output for debugging
  console.log();
  console.log('Full extracted data:');
  console.log(JSON.stringify(concursoData, null, 2));
}

// Run the test
runTest().catch(error => {
  console.error('Test failed with error:', error);
  process.exit(1);
});







