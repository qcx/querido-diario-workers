#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

async function fixMarkdownTable() {
  const readmePath = resolve(__dirname, 'README.md');
  let content = readFileSync(readmePath, 'utf-8');
  
  // Fix the entire table section
  const fixedTable = `| UF | Estado | Total | Únicos | Configs | Cobertura | Fallbacks | Progresso |
|----|--------|-------|---------|---------|-----------|-----------|-----------|
| **MT** | Mato Grosso | 141 | 142 | 143 | **100.7%** | +1 | \`████████████████████\` |
| **AM** | Amazonas | 62 | 62 | 62 | **100.0%** | +0 | \`████████████████████\` |
| **SC** | Santa Catarina | 295 | 295 | 295 | **100.0%** | +0 | \`████████████████████\` |
| **PE** | Pernambuco | 185 | 182 | 185 | **98.4%** | +3 | \`████████████████████\` |
| **BA** | Bahia | 417 | 407 | 478 | **97.6%** | +71 | \`████████████████████\` |
| **RN** | Rio Grande do Norte | 167 | 161 | 164 | **96.4%** | +3 | \`███████████████████░\` |
| **CE** | Ceará | 184 | 131 | 139 | **71.2%** | +8 | \`██████████████░░░░░░\` |
| **SP** | São Paulo | 645 | 456 | 589 | **70.7%** | +133 | \`██████████████░░░░░░\` |
| **MG** | Minas Gerais | 853 | 486 | 492 | **57.0%** | +6 | \`███████████░░░░░░░░░\` |
| **RS** | Rio Grande do Sul | 497 | 278 | 281 | **55.9%** | +3 | \`███████████░░░░░░░░░\` |
| **PR** | Paraná | 399 | 197 | 199 | **49.4%** | +2 | \`██████████░░░░░░░░░░\` |
| **SE** | Sergipe | 75 | 28 | 28 | **37.3%** | +0 | \`███████░░░░░░░░░░░░░\` |
| **GO** | Goiás | 246 | 88 | 88 | **35.8%** | +0 | \`███████░░░░░░░░░░░░░\` |
| **RJ** | Rio de Janeiro | 92 | 20 | 20 | **21.7%** | +0 | \`████░░░░░░░░░░░░░░░░\` |
| **PI** | Piauí | 224 | 31 | 31 | **13.8%** | +0 | \`███░░░░░░░░░░░░░░░░░\` |
| **PB** | Paraíba | 223 | 30 | 31 | **13.5%** | +1 | \`███░░░░░░░░░░░░░░░░░\` |
| **TO** | Tocantins | 139 | 18 | 18 | **12.9%** | +0 | \`███░░░░░░░░░░░░░░░░░\` |
| **MA** | Maranhão | 217 | 23 | 23 | **10.6%** | +0 | \`██░░░░░░░░░░░░░░░░░░\` |
| **MS** | Mato Grosso do Sul | 79 | 8 | 8 | **10.1%** | +0 | \`██░░░░░░░░░░░░░░░░░░\` |
| **AP** | Amapá | 16 | 1 | 1 | **6.3%** | +0 | \`█░░░░░░░░░░░░░░░░░░░\` |
| **AL** | Alagoas | 102 | 1 | 1 | **1.0%** | +0 | \`░░░░░░░░░░░░░░░░░░░░\` |
| **PA** | Pará | 144 | 1 | 1 | **0.7%** | +0 | \`░░░░░░░░░░░░░░░░░░░░\` |
| **AC** | Acre | 22 | 0 | 0 | **0.0%** | +0 | \`░░░░░░░░░░░░░░░░░░░░\` |
| **DF** | Distrito Federal | 1 | 0 | 0 | **0.0%** | +0 | \`░░░░░░░░░░░░░░░░░░░░\` |
| **ES** | Espírito Santo | 78 | 0 | 0 | **0.0%** | +0 | \`░░░░░░░░░░░░░░░░░░░░\` |
| **RO** | Rondônia | 52 | 0 | 0 | **0.0%** | +0 | \`░░░░░░░░░░░░░░░░░░░░\` |
| **RR** | Roraima | 15 | 0 | 0 | **0.0%** | +0 | \`░░░░░░░░░░░░░░░░░░░░\` |`;

  // Find and replace the table section
  const tableStart = content.indexOf('| UF | Estado | Total | Únicos | Configs | Cobertura | Fallbacks | Progresso |');
  const tableEnd = content.indexOf('\n\n*Sistema de fallback', tableStart);
  
  if (tableStart !== -1 && tableEnd !== -1) {
    content = content.substring(0, tableStart) + fixedTable + content.substring(tableEnd);
    writeFileSync(readmePath, content);
    console.log('✅ Tabela Markdown corrigida com formatação adequada!');
  } else {
    console.log('❌ Não foi possível encontrar a seção da tabela');
  }
}

fixMarkdownTable().catch(console.error);
