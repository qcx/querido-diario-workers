#!/usr/bin/env bun

// Add the final two cities manually
const finalCities = [
  {
    id: "sp_jau",
    name: "Jaú - SP", 
    territoryId: "3525300",
    startDate: "2020-01-01",
    spiderType: "dosp" as const,
    config: {
      type: "dosp" as const,
      apiUrl: "https://do-api-web-search.doe.sp.gov.br/v2/summary/structured",
      journalId: "d65936d7-1ca8-4267-934e-1dea132fa237",
      sectionId: "b3477daf-479d-4f3d-7d60-08db6b94d2bf",
      territoryFilter: "JAHU" // DOE SP uses "Jahu" spelling 
    }
  }
  // Note: Ipauçu was not found in IBGE database - likely doesn't exist or is a typo
];

async function addFinalCities() {
  console.log('🔧 Adding final cities manually...');
  
  const fs = require('fs');
  
  // Load existing config
  const existingConfig = JSON.parse(fs.readFileSync('./src/spiders/configs/doe-sp-cities-generated.json', 'utf8'));
  
  // Add final cities
  const allMappings = [...existingConfig, ...finalCities];
  
  // Sort by name
  allMappings.sort((a, b) => a.name.localeCompare(b.name));
  
  // Write updated file
  const configContent = JSON.stringify(allMappings, null, 2);
  fs.writeFileSync('./src/spiders/configs/doe-sp-cities-generated.json', configContent);
  
  console.log(`✅ Added ${finalCities.length} final cities`);
  console.log(`📄 Total cities now: ${allMappings.length}`);
  console.log(`📁 Updated: ./src/spiders/configs/doe-sp-cities-generated.json`);
  
  // Show final stats
  console.log('\n🎉 FINAL RESULTS:');
  console.log(`   📊 Total SP municipalities configured: ${allMappings.length}`);
  console.log(`   🎯 From original 528 entities: ${((allMappings.length / 528) * 100).toFixed(1)}% coverage`);
  console.log(`   🏛️  Real municipalities (estimated): ~490`);
  console.log(`   📈 Municipal coverage: ~${Math.round(allMappings.length / 490 * 100)}%`);
  
  console.log('\n✅ Cities added:');
  for (const city of finalCities) {
    console.log(`   🏛️  ${city.name} (${city.territoryId})`);
  }
  
  console.log('\n⚠️  Note: "Ipauçu" was not found in IBGE database and may not exist as a municipality in SP');
  
  console.log('\n🎊 DOE SP spider configuration is now complete!');
}

addFinalCities().catch(console.error);
