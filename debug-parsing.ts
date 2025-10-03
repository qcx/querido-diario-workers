import { loadHTML } from './src/utils/html-parser';
import { parseBrazilianDate } from './src/utils/date-utils';

async function debugParsing() {
  const url = 'https://doem.org.br/ba/acajutiba/diarios/2024/09';
  
  console.log('Fetching:', url);
  const response = await fetch(url);
  const html = await response.text();
  
  console.log('HTML length:', html.length);
  
  const $ = loadHTML(html);
  const boxes = $('div.box-diario');
  
  console.log('Found boxes:', boxes.length);
  
  // Debug first box
  const firstBox = boxes.first();
  console.log('\n=== First Box Debug ===');
  
  const dateText = firstBox.find('span.data-diario').text().trim();
  console.log('Date text:', dateText);
  
  if (dateText) {
    try {
      const date = parseBrazilianDate(dateText);
      console.log('Parsed date:', date);
    } catch (e) {
      console.error('Date parsing error:', e);
    }
  }
  
  const editionText = firstBox.find('h2').first().text();
  console.log('Edition text:', editionText);
  
  const editionMatch = editionText.match(/Edição\s+([.\d]+)/);
  console.log('Edition match:', editionMatch);
  
  const downloadLink = firstBox.find('a[title="Baixar Publicação"]');
  console.log('Download link found:', downloadLink.length);
  console.log('Download link href:', downloadLink.attr('href'));
  
  // Try alternative selectors
  console.log('\n=== Alternative Selectors ===');
  const allLinks = firstBox.find('a');
  console.log('Total links in box:', allLinks.length);
  
  allLinks.each((i, elem) => {
    const $elem = $(elem);
    const title = $elem.attr('title');
    const href = $elem.attr('href');
    const text = $elem.text().trim().substring(0, 50);
    console.log(`Link ${i}: title="${title}", href="${href}", text="${text}"`);
  });
}

debugParsing();
