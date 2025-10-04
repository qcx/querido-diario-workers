#!/usr/bin/env python3
"""
Script para criar configuração do AMM-MT
Identifica municípios MT que NÃO estão no SIGPub
"""

import json
import unicodedata
import re

def normalize_name(name):
    """Normaliza nome do município para comparação"""
    name = unicodedata.normalize('NFD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    name = re.sub(r'[^A-Z0-9\s]', '', name.upper())
    name = ' '.join(name.split())
    return name

# Carregar municípios do IBGE
with open('mt-municipios-ibge.json', 'r', encoding='utf-8') as f:
    ibge_data = json.load(f)

# Criar mapa de códigos IBGE
ibge_map = {}
for mun in ibge_data:
    normalized = normalize_name(mun['nome'])
    ibge_map[normalized] = {
        'id': mun['id'],
        'nome': mun['nome']
    }

# Carregar municípios já cobertos pelo SIGPub
with open('src/spiders/configs/sigpub-cities.json', 'r', encoding='utf-8') as f:
    sigpub_data = json.load(f)

# Criar set de territoryIds já cobertos pelo SIGPub em MT
sigpub_mt_ids = set()
for config in sigpub_data:
    if config.get('stateCode') == 'MT':
        sigpub_mt_ids.add(config['territoryId'])

print(f"📊 Municípios MT no SIGPub: {len(sigpub_mt_ids)}")
print(f"📊 Total de municípios MT no IBGE: {len(ibge_data)}")

# Criar configurações para municípios NÃO cobertos pelo SIGPub
configs = []

for mun in ibge_data:
    territory_id = str(mun['id'])
    
    # Pular se já está no SIGPub
    if territory_id in sigpub_mt_ids:
        continue
    
    # Normalizar nome para usar no site
    city_name = mun['nome'].upper()
    city_name = unicodedata.normalize('NFD', city_name)
    city_name = ''.join(c for c in city_name if unicodedata.category(c) != 'Mn')
    
    config = {
        "id": f"mt_{territory_id}",
        "name": mun['nome'],
        "stateCode": "MT",
        "territoryId": territory_id,
        "spiderType": "amm-mt",
        "config": {
            "url": "https://amm.diariomunicipal.org/",
            "cityName": city_name
        }
    }
    configs.append(config)

# Salvar configurações
output = {
    "total": len(configs),
    "municipalities": configs
}

with open('src/spiders/configs/amm-mt-cities.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"✅ Criadas {len(configs)} configurações para AMM-MT")
print(f"📊 Municípios MT não cobertos pelo SIGPub: {len(configs)}")

# Mostrar alguns exemplos
if configs:
    print(f"\n📋 Exemplos de municípios AMM-MT:")
    for config in configs[:5]:
        print(f"  - {config['name']} ({config['territoryId']})")
