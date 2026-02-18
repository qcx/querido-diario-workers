import * as fs from 'fs';
import * as path from 'path';

interface CityRow {
  cidade: string;
  uf: string;
  url: string;
}

interface IBGECity {
  id: number;
  nome: string;
}

interface CityResult {
  cidade: string;
  url: string;
  territoryId?: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  spiderType?: string;
  error?: string;
}

// Mapeamento de cidades do CSV para códigos IBGE
const IBGE_MAP: Record<string, string> = {
  'Serra': '3205002',
  'Vila Velha': '3205200',
  'Cariacica': '3201308',
  'Vitória': '3205309',
  'Cachoeiro de Itapemirim': '3201209',
  'Linhares': '3203205',
  'Guarapari': '3202405',
  'São Mateus': '3204906',
  'Colatina': '3201506',
  'Aracruz': '3200607',
  'Viana': '3205101',
  'Nova Venécia': '3203908',
  'Barra de São Francisco': '3200904',
  'Marataízes': '3203320',
  'Santa Maria de Jetibá': '3204559',
  'Itapemirim': '3202801',
  'Castelo': '3201407',
  'Domingos Martins': '3201902',
  'Afonso Cláudio': '3200102',
  'Baixo Guandu': '3200805',
  'Anchieta': '3200409',
  'Guaçuí': '3202306',
  'Alegre': '3200201',
  'Jaguaré': '3203056',
  'Iúna': '3203007',
  'Conceição da Barra': '3201605',
  'Sooretama': '3205010',
  'Ibatiba': '3202454',
};

function createSlug(cityName: string): string {
  return cityName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

async function main() {
  const csvPath = path.join(__dirname, '../../diarios_oficiais_es_consolidado.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').filter(line => line.trim());
  
  // Skip header
  const cities: CityRow[] = lines.slice(1).map(line => {
    const [cidade, uf, url] = line.split(',');
    return { cidade: cidade.trim(), uf: uf.trim(), url: url.trim() };
  });

  console.log(`Found ${cities.length} cities to process`);

  const results: CityResult[] = cities.map(city => ({
    cidade: city.cidade,
    url: city.url,
    territoryId: IBGE_MAP[city.cidade],
    status: 'pending',
  }));

  // Save initial results
  const resultsPath = path.join(__dirname, 'es-cities-results.json');
  fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

  console.log(`Results saved to ${resultsPath}`);
  console.log(`\nCities to process:`);
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.cidade} (${r.territoryId || 'NO IBGE'}) - ${r.url}`);
  });
}

main().catch(console.error);
