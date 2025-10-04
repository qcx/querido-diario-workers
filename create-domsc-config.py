import json
import unicodedata
import re

def normalize_name(name):
    """Normaliza nome do município removendo acentos e convertendo para minúsculas"""
    # Remove acentos
    nfkd = unicodedata.normalize('NFKD', name)
    name_without_accents = ''.join([c for c in nfkd if not unicodedata.combining(c)])
    # Remove espaços extras e converte para minúsculas
    return re.sub(r'\s+', ' ', name_without_accents.lower().strip())

# Carregar municípios do Brasil
with open('municipios-brasil.json', 'r', encoding='utf-8') as f:
    municipios_brasil = json.load(f)

# Filtrar apenas Santa Catarina (código UF 42)
municipios_sc = [m for m in municipios_brasil if m['codigo_uf'] == 42]

print(f"Total de municípios em SC: {len(municipios_sc)}")

# Criar dicionário para busca rápida por nome normalizado
municipios_sc_dict = {}
for m in municipios_sc:
    nome_norm = normalize_name(m['nome'])
    municipios_sc_dict[nome_norm] = m

# Carregar lista de prefeituras encontradas no DOM/SC
with open('domsc-prefeituras-raw.json', 'r', encoding='utf-8') as f:
    prefeituras_domsc = json.load(f)

print(f"Total de prefeituras no DOM/SC: {len(prefeituras_domsc)}")

# Mapear prefeituras do DOM/SC com códigos IBGE
matched = []
unmatched = []

for pref in prefeituras_domsc:
    nome_norm = normalize_name(pref)
    if nome_norm in municipios_sc_dict:
        m = municipios_sc_dict[nome_norm]
        matched.append({
            'nome_domsc': pref,
            'nome_ibge': m['nome'],
            'codigo_ibge': m['codigo_ibge'],
            'latitude': m['latitude'],
            'longitude': m['longitude']
        })
    else:
        unmatched.append(pref)

print(f"\nMunicípios mapeados: {len(matched)}")
print(f"Municípios não mapeados: {len(unmatched)}")

if unmatched:
    print("\nNão mapeados:")
    for u in unmatched[:20]:
        print(f"  - {u}")

# Salvar resultados
with open('domsc-municipios-mapped.json', 'w', encoding='utf-8') as f:
    json.dump(matched, f, ensure_ascii=False, indent=2)

print(f"\nArquivo salvo: domsc-municipios-mapped.json")

# Criar configuração no formato do projeto
domsc_config = []
for m in sorted(matched, key=lambda x: x['nome_ibge']):
    city_id = f"sc_{m['codigo_ibge']}"
    domsc_config.append({
        "id": city_id,
        "name": m['nome_ibge'],
        "stateCode": "SC",
        "territoryId": str(m['codigo_ibge']),
        "spiderType": "dom-sc",
        "config": {
            "url": "https://diariomunicipal.sc.gov.br/",
            "entityName": m['nome_domsc']
        }
    })

with open('src/spiders/configs/dom-sc-cities.json', 'w', encoding='utf-8') as f:
    json.dump(domsc_config, f, ensure_ascii=False, indent=2)

print(f"Configuração criada: src/spiders/configs/dom-sc-cities.json ({len(domsc_config)} municípios)")
