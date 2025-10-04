#!/usr/bin/env python3
"""
Script para adicionar municípios do Amazonas (AAM) ao SIGPub
AAM usa plataforma SIGPub padrão
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
with open('am-municipios-ibge.json', 'r', encoding='utf-8') as f:
    ibge_data = json.load(f)

# Carregar configuração SIGPub existente
with open('src/spiders/configs/sigpub-cities.json', 'r', encoding='utf-8') as f:
    sigpub_data = json.load(f)

# Verificar quais municípios AM já estão no SIGPub
existing_am_ids = set()
for config in sigpub_data:
    if config.get('stateCode') == 'AM':
        existing_am_ids.add(config['territoryId'])

print(f"📊 Municípios AM já no SIGPub: {len(existing_am_ids)}")
print(f"📊 Total de municípios AM no IBGE: {len(ibge_data)}")

# Criar configurações para municípios AM
new_configs = []

for mun in ibge_data:
    territory_id = str(mun['id'])
    
    # Pular se já está no SIGPub
    if territory_id in existing_am_ids:
        continue
    
    # Criar configuração SIGPub para AAM
    # Nota: entityId precisa ser descoberto testando o site
    # Por enquanto, usar "0" como placeholder
    config = {
        "id": f"am_{territory_id}",
        "name": mun['nome'],
        "stateCode": "AM",
        "territoryId": territory_id,
        "spiderType": "sigpub",
        "config": {
            "type": "sigpub",
            "url": "https://www.diariomunicipal.com.br/aam/",
            "entityId": "0"  # Placeholder - precisa ser descoberto
        }
    }
    new_configs.append(config)

# Adicionar novas configurações ao SIGPub
sigpub_data.extend(new_configs)

# Salvar configuração atualizada
with open('src/spiders/configs/sigpub-cities.json', 'w', encoding='utf-8') as f:
    json.dump(sigpub_data, f, ensure_ascii=False, indent=2)

# Também salvar separadamente para referência
output = {
    "total": len(new_configs),
    "municipalities": new_configs
}

with open('aam-cities-added.json', 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)

print(f"✅ Adicionados {len(new_configs)} municípios AM ao SIGPub")
print(f"📊 Total de configurações SIGPub agora: {len(sigpub_data)}")

if new_configs:
    print(f"\n📋 Exemplos de municípios AM adicionados:")
    for config in new_configs[:5]:
        print(f"  - {config['name']} ({config['territoryId']})")
    
print(f"\n⚠️  NOTA: O campo entityId está como '0' (placeholder)")
print(f"   Será necessário testar o site para descobrir o entityId correto da AAM")
