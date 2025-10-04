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

# Filtrar apenas Goiás (código UF 52)
municipios_go = [m for m in municipios_brasil if m['codigo_uf'] == 52]

print(f"Total de municípios em GO (IBGE): {len(municipios_go)}")

# Criar dicionário para busca rápida
municipios_go_dict = {}
for m in municipios_go:
    nome_norm = normalize_name(m['nome'])
    municipios_go_dict[nome_norm] = m

# Carregar municípios do AGM
with open('agm-municipios-raw.json', 'r', encoding='utf-8') as f:
    municipios_agm = json.load(f)

print(f"Total de municípios no AGM: {len(municipios_agm)}")

# Mapear com códigos IBGE
matched = []
unmatched = []

for m_agm in municipios_agm:
    nome_norm = normalize_name(m_agm['nome'])
    if nome_norm in municipios_go_dict:
        m_ibge = municipios_go_dict[nome_norm]
        matched.append({
            'nome_agm': m_agm['nome'],
            'nome_ibge': m_ibge['nome'],
            'codigo_ibge': m_ibge['codigo_ibge'],
            'value': m_agm['value']
        })
    else:
        unmatched.append(m_agm['nome'])

print(f"\nMunicípios mapeados: {len(matched)}")
print(f"Municípios não mapeados: {len(unmatched)}")

if unmatched:
    print("\nNão mapeados:")
    for u in unmatched:
        print(f"  - {u}")

# Criar configuração no formato SIGPub
sigpub_config = []
for m in sorted(matched, key=lambda x: x['nome_ibge']):
    city_id = f"go_{m['codigo_ibge']}"
    sigpub_config.append({
        "id": city_id,
        "name": m['nome_ibge'],
        "stateCode": "GO",
        "territoryId": str(m['codigo_ibge']),
        "spiderType": "sigpub",
        "config": {
            "url": "https://www.diariomunicipal.com.br/agm/",
            "entityId": m['value']
        }
    })

# Salvar configuração
with open('agm-go-cities.json', 'w', encoding='utf-8') as f:
    json.dump(sigpub_config, f, ensure_ascii=False, indent=2)

print(f"\nConfiguração criada: agm-go-cities.json ({len(sigpub_config)} municípios)")
print("\nPrimeiros 5 municípios:")
for i in range(min(5, len(sigpub_config))):
    print(f"  {sigpub_config[i]['name']} - {sigpub_config[i]['territoryId']}")
