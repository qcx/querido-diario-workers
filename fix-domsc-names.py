import json
import unicodedata
import re

def normalize_name(name):
    """Normaliza nome do município removendo acentos e convertendo para minúsculas"""
    nfkd = unicodedata.normalize('NFKD', name)
    name_without_accents = ''.join([c for c in nfkd if not unicodedata.combining(c)])
    return re.sub(r'\s+', ' ', name_without_accents.lower().strip())

# Carregar municípios do Brasil
with open('municipios-brasil.json', 'r', encoding='utf-8') as f:
    municipios_brasil = json.load(f)

# Filtrar apenas Santa Catarina (código UF 42)
municipios_sc = [m for m in municipios_brasil if m['codigo_uf'] == 42]

print(f"Total de municípios em SC (IBGE): {len(municipios_sc)}")

# Criar configuração no formato do projeto usando TODOS os municípios de SC do IBGE
domsc_config = []
for m in sorted(municipios_sc, key=lambda x: x['nome']):
    city_id = f"sc_{m['codigo_ibge']}"
    domsc_config.append({
        "id": city_id,
        "name": m['nome'],
        "stateCode": "SC",
        "territoryId": str(m['codigo_ibge']),
        "spiderType": "dom-sc",
        "config": {
            "url": "https://diariomunicipal.sc.gov.br/",
            "entityName": f"Prefeitura Municipal de {m['nome']}"
        }
    })

with open('src/spiders/configs/dom-sc-cities.json', 'w', encoding='utf-8') as f:
    json.dump(domsc_config, f, ensure_ascii=False, indent=2)

print(f"Configuração criada: src/spiders/configs/dom-sc-cities.json ({len(domsc_config)} municípios)")
print("\nPrimeiros 5 municípios:")
for i in range(min(5, len(domsc_config))):
    print(f"  {domsc_config[i]['name']} - {domsc_config[i]['territoryId']}")
