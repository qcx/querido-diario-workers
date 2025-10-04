#!/usr/bin/env python3
"""
Script para criar configuração do Diário Oficial BA
Mapeia municípios extraídos do site para códigos IBGE
"""

import json
import unicodedata
import re

def normalize_name(name):
    """Normaliza nome do município para comparação"""
    # Remove acentos
    name = unicodedata.normalize('NFD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    # Remove caracteres especiais e converte para maiúsculas
    name = re.sub(r'[^A-Z0-9\s]', '', name.upper())
    # Remove espaços extras
    name = ' '.join(name.split())
    return name

# Carregar municípios do IBGE
with open('ba-municipios-ibge.json', 'r', encoding='utf-8') as f:
    ibge_data = json.load(f)

# Criar mapa de nomes normalizados para dados IBGE
ibge_map = {}
for mun in ibge_data:
    normalized = normalize_name(mun['nome'])
    ibge_map[normalized] = {
        'id': mun['id'],
        'nome': mun['nome']
    }

# Carregar municípios extraídos do site
with open('diario-ba-municipios-raw.json', 'r', encoding='utf-8') as f:
    site_data = json.load(f)

# Criar configurações
configs = []
not_found = []

for mun in site_data['municipalities']:
    site_name = mun['text']
    normalized = normalize_name(site_name)
    
    if normalized in ibge_map:
        ibge_info = ibge_map[normalized]
        territory_id = str(ibge_info['id'])
        
        config = {
            "id": f"ba_{territory_id}",
            "name": ibge_info['nome'],
            "stateCode": "BA",
            "territoryId": territory_id,
            "spiderType": "diario-ba",
            "config": {
                "url": "https://www.diariooficialba.com.br/",
                "cityName": mun['value']
            }
        }
        configs.append(config)
    else:
        not_found.append(site_name)

# Salvar configurações
output = {
    "total": len(configs),
    "municipalities": configs
}

with open('src/spiders/configs/diario-ba-cities.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"✅ Criadas {len(configs)} configurações para Diário Oficial BA")
print(f"📊 Total de municípios BA no IBGE: {len(ibge_data)}")
print(f"📊 Total de municípios no site: {len(site_data['municipalities'])}")

if not_found:
    print(f"\n⚠️  {len(not_found)} municípios não encontrados no IBGE:")
    for name in not_found[:10]:
        print(f"  - {name}")
    if len(not_found) > 10:
        print(f"  ... e mais {len(not_found) - 10}")
