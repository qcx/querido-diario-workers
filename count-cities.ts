import { spiderRegistry } from './src/spiders/registry';

const types = ['instar', 'dosp', 'adiarios_v1', 'adiarios_v2', 'diof', 'doem', 'barco_digital', 'siganet', 'diario_oficial_br', 'modernizacao', 'aplus', 'dioenet', 'administracao_publica', 'ptio'];

console.log('\n=== Total de cidades registradas ===\n');

let total = 0;
for (const type of types) {
  const configs = spiderRegistry.getConfigsByType(type as any);
  console.log(`${type.toUpperCase().padEnd(15)}: ${configs.length} cidades`);
  total += configs.length;
}

console.log(`${''.padEnd(15, '-')}: ${'-'.repeat(10)}`);
console.log(`${'TOTAL'.padEnd(15)}: ${total} cidades\n`);
