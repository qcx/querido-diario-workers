import axios from "axios";
import fs from "fs";

const IBGE_URL =
  "https://servicodados.ibge.gov.br/api/v1/localidades/municipios?view=nivelado";

async function generate() {
  try {
    const res = await axios.get(IBGE_URL, { timeout: 45000 });

    const municipios = res.data
      .filter(m => m && m["municipio-nome"] && m["UF-sigla"] && m["UF-nome"])
      .map((m) => ({
        name: m["municipio-nome"].trim(),
        uf: m["UF-sigla"],
        ufName: m["UF-nome"],
        microrregiaoNome: m["microrregiao-nome"],
        regiaoNome: m["regiao-imediata-nome"]
      }));

    // Remove duplicados, se existir
    const unique = Array.from(
      new Map(municipios.map(m => [m.name + m.uf + m.ufName + m.microrregiaoNome + m.regiaoNome, m])).values()
    );

    fs.writeFileSync(
      "./municipios_ibge.json",
      JSON.stringify(unique, null, 2),
      "utf8"
    );

    console.log("✅ municipios_ibge.json gerado com sucesso!");
    console.log(`📌 Total de válidos: ${unique.length}`);
    console.log(
      `⚠️ Registros ignorados: ${res.data.length - unique.length}`
    );

  } catch (err) {
    console.error("❌ Erro ao baixar dados do IBGE:", err.message);
  }
}

generate();
