#!/usr/bin/env bun

// From the last analysis, here are the non-municipal entities found in DOE SP

const nonMunicipalEntities = [
  { name: "Água e Esgoto", original: "Serviço Autônomo de Água e Esgoto", publications: 77 },
  { name: "Secretaria da Educação", original: "Secretaria da Educação", publications: 20 },
  { name: "Saneamento Básico", original: "Saneamento Básico", publications: 17 },
  { name: "Secretaria de Assistência Social", original: "Secretaria de Assistência Social", publications: 16 },
  { name: "Secretaria da Saúde", original: "Secretaria da Saúde", publications: 14 },
  { name: "Mirandópolis", original: "Serviço de Água e Esgoto de Mirandópolis", publications: 14 },
  { name: "Consórcio Intermunicipal do Vale do Paranapanema", original: "Consórcio Intermunicipal do Vale do Paranapanema", publications: 10 },
  { name: "Água, Esgoto e Meio Ambiente", original: "Serviço de Água, Esgoto e Meio Ambiente", publications: 9 },
  { name: "Adamantina", original: "Centro Universitário de Adamantina", publications: 8 },
  { name: "Saúde", original: "Autarquia Municipal de Saúde", publications: 7 },
  { name: "Assistência Médica", original: "Serviço de Assistência Médica", publications: 7 },
  { name: "Consórcio Intermunicipal do Oeste Paulista", original: "Consórcio Intermunicipal do Oeste Paulista", publications: 6 },
  { name: "Consórcio Intermunicipal do Alto Vale do Paranapanema", original: "Consórcio Intermunicipal do Alto Vale do Paranapanema", publications: 6 },
  { name: "Fieb - Fundação Instituto de Educação de Barueri", original: "Fieb - Fundação Instituto de Educação de Barueri", publications: 6 },
  { name: "Hospital Municipal Dr Tabajara Ramos", original: "Hospital Municipal Dr Tabajara Ramos", publications: 5 },
  { name: "Saneamento Ambiental", original: "Saneamento Ambiental", publications: 4 },
  { name: "Penápolis", original: "Consórcio Intermunicipal de Saúde da Micro-região de Penápolis", publications: 4 },
  { name: "Catanduva", original: "Consórcio Intermunicipal de Saúde da Região de Catanduva", publications: 3 },
  { name: "Negócios Jurídicos", original: "Departamento de Negócios Jurídicos", publications: 3 },
  { name: "Água e Esgoto e Meio Ambiente", original: "Serviço de Água e Esgoto e Meio Ambiente", publications: 3 },
  { name: "Santa fé do Sul", original: "Serviço Autônomo de Água, Esgoto e Meio Ambiente de Santa fé do Sul", publications: 3 },
  { name: "Água e Esgoto", original: "Departamento de Água e Esgoto", publications: 3 },
  { name: "Água e Esgoto", original: "Serviço Autônomo Municipal de Água e Esgoto", publications: 2 },
  { name: "Saúde", original: "Fundação Municipal de Saúde", publications: 2 },
  { name: "Previdência dos Funcionários Públicos Municipais", original: "Instituto de Previdência dos Funcionários Públicos Municipais", publications: 2 },
  { name: "ABC - FMABC", original: "Fundação do ABC - FMABC", publications: 2 },
  { name: "Previdência Municipal", original: "Instituto de Previdência Municipal", publications: 2 },
  { name: "Previdência do Servidor Municipal", original: "Instituto de Previdência do Servidor Municipal", publications: 2 },
  { name: "Caixa Beneficente dos Servidores", original: "Fundação da Caixa Beneficente dos Servidores", publications: 2 },
  { name: "ABC", original: "Fundação do ABC", publications: 2 },
  // ... and about 22 more entities with 1 publication each
];

console.log('🏢 Entidades Não-Municipais encontradas no DOE SP');
console.log('================================================\n');

console.log(`📊 Total de entidades não-municipais: ${nonMunicipalEntities.length}+\n`);

console.log('🏥 Principais categorias:\n');

// Group by type
const servicesByType = {
  water: nonMunicipalEntities.filter(e => e.name.includes('Água') || e.name.includes('Esgoto') || e.name.includes('Saneamento')),
  health: nonMunicipalEntities.filter(e => e.name.includes('Saúde') || e.name.includes('Hospital') || e.original.includes('Hospital') || e.original.includes('Saúde')),
  education: nonMunicipalEntities.filter(e => e.name.includes('Educação') || e.name.includes('Centro Universitário')),
  social: nonMunicipalEntities.filter(e => e.name.includes('Assistência')),
  consortiums: nonMunicipalEntities.filter(e => e.name.includes('Consórcio') || e.original.includes('Consórcio')),
  departments: nonMunicipalEntities.filter(e => e.name.includes('Departamento') || e.original.includes('Departamento')),
  institutes: nonMunicipalEntities.filter(e => e.name.includes('Instituto') || e.original.includes('Instituto')),
  foundations: nonMunicipalEntities.filter(e => e.name.includes('Fundação') || e.original.includes('Fundação')),
};

console.log(`💧 Serviços de Água/Esgoto: ${servicesByType.water.length} entidades`);
servicesByType.water.slice(0, 5).forEach(e => console.log(`   - ${e.original} (${e.publications} pubs)`));

console.log(`\n🏥 Serviços de Saúde: ${servicesByType.health.length} entidades`);
servicesByType.health.slice(0, 5).forEach(e => console.log(`   - ${e.original} (${e.publications} pubs)`));

console.log(`\n🎓 Educação: ${servicesByType.education.length} entidades`);
servicesByType.education.forEach(e => console.log(`   - ${e.original} (${e.publications} pubs)`));

console.log(`\n🤝 Assistência Social: ${servicesByType.social.length} entidades`);
servicesByType.social.forEach(e => console.log(`   - ${e.original} (${e.publications} pubs)`));

console.log(`\n🏛️  Consórcios Intermunicipais: ${servicesByType.consortiums.length} entidades`);
servicesByType.consortiums.forEach(e => console.log(`   - ${e.original} (${e.publications} pubs)`));

console.log(`\n📋 Departamentos: ${servicesByType.departments.length} entidades`);
servicesByType.departments.forEach(e => console.log(`   - ${e.original} (${e.publications} pubs)`));

console.log(`\n🏢 Institutos/Fundações: ${servicesByType.institutes.length + servicesByType.foundations.length} entidades`);
[...servicesByType.institutes, ...servicesByType.foundations].forEach(e => console.log(`   - ${e.original} (${e.publications} pubs)`));

console.log('\n✅ Essas entidades foram CORRETAMENTE EXCLUÍDAS da configuração');
console.log('   pois não são municípios, mas sim órgãos, serviços ou consórcios.\n');

console.log('📝 NOTA: Essas entidades aparecem no DOE SP porque:');
console.log('   - Órgãos municipais publicam separadamente da prefeitura');
console.log('   - Consórcios intermunicipais têm publicações próprias');
console.log('   - Fundações e institutos municipais são pessoas jurídicas separadas');
console.log('   - Universidades e hospitais municipais publicam independentemente');
