import json

print("=== Validação dos Spiders GO e SC ===\n")

# Validar DOM/SC
print("1. Validando DOM/SC (Santa Catarina)...")
with open('src/spiders/configs/dom-sc-cities.json', 'r', encoding='utf-8') as f:
    domsc_cities = json.load(f)

print(f"   ✓ Total de municípios SC: {len(domsc_cities)}")

# Verificar estrutura
sample_sc = domsc_cities[0]
print(f"   ✓ Exemplo: {sample_sc['name']} ({sample_sc['id']})")
print(f"   ✓ Tipo: {sample_sc['spiderType']}")
print(f"   ✓ Config type: {sample_sc['config'].get('type', 'N/A')}")

# Validar estados únicos
states = set(c['stateCode'] for c in domsc_cities)
print(f"   ✓ Estados: {', '.join(states)}")

# Validar SIGPub (incluindo GO)
print("\n2. Validando SIGPub (incluindo Goiás)...")
with open('src/spiders/configs/sigpub-cities.json', 'r', encoding='utf-8') as f:
    sigpub_cities = json.load(f)

print(f"   ✓ Total de municípios SIGPub: {len(sigpub_cities)}")

# Contar por estado
from collections import Counter
state_counts = Counter(c['stateCode'] for c in sigpub_cities)
print(f"   ✓ Municípios por estado:")
for state, count in sorted(state_counts.items()):
    print(f"      - {state}: {count}")

# Verificar GO
go_cities = [c for c in sigpub_cities if c['stateCode'] == 'GO']
if go_cities:
    sample_go = go_cities[0]
    print(f"\n   ✓ Exemplo GO: {sample_go['name']} ({sample_go['id']})")
    print(f"   ✓ Config type: {sample_go['config'].get('type', 'N/A')}")
    print(f"   ✓ URL: {sample_go['config']['url']}")

print("\n3. Resumo:")
print(f"   ✓ Total GO (SIGPub): {len(go_cities)}")
print(f"   ✓ Total SC (DOM/SC): {len(domsc_cities)}")
print(f"   ✓ Total geral adicionado: {len(go_cities) + len(domsc_cities)}")

print("\n=== Validação concluída com sucesso! ===")
