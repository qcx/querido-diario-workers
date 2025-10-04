const fs = require('fs');

// Read the extracted data
const data = JSON.parse(fs.readFileSync('/home/ubuntu/extract_instar_cities.json', 'utf8'));

// Convert to TypeScript config format
const configs = data.results
  .filter(r => !r.error && r.output.spider_id)
  .map(r => ({
    id: r.output.spider_id,
    name: r.output.city_name,
    territoryId: r.output.territory_id,
    spiderType: "instar",
    startDate: r.output.start_date,
    config: {
      type: "instar",
      url: r.output.base_url
    }
  }));

console.log(`Extracted ${configs.length} Instar cities`);
fs.writeFileSync('src/spiders/configs/instar-cities.json', JSON.stringify(configs, null, 2));
console.log('Saved to src/spiders/configs/instar-cities.json');
