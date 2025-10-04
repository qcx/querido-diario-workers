import json

# Carregar configurações
with open('src/spiders/configs/sigpub-cities.json', 'r', encoding='utf-8') as f:
    configs = json.load(f)

print(f"✅ Arquivo carregado com sucesso!")
print(f"📊 Total de configurações: {len(configs)}")

# Validar estrutura
required_fields = ['id', 'name', 'territoryId', 'spiderType', 'startDate', 'config']
errors = []

for idx, config in enumerate(configs):
    # Verificar campos obrigatórios
    for field in required_fields:
        if field not in config:
            errors.append(f"Config {idx}: Campo '{field}' ausente")
    
    # Verificar territoryId (código IBGE de 7 dígitos)
    if 'territoryId' in config:
        if not isinstance(config['territoryId'], str) or len(config['territoryId']) != 7:
            errors.append(f"Config {idx} ({config.get('id', 'unknown')}): territoryId inválido: {config['territoryId']}")
    
    # Verificar spiderType
    if config.get('spiderType') != 'sigpub':
        errors.append(f"Config {idx}: spiderType deve ser 'sigpub', encontrado: {config.get('spiderType')}")
    
    # Verificar config.type
    if 'config' in config and config['config'].get('type') != 'sigpub':
        errors.append(f"Config {idx}: config.type deve ser 'sigpub'")
    
    # Verificar config.url
    if 'config' in config and 'url' not in config['config']:
        errors.append(f"Config {idx}: config.url ausente")

if errors:
    print(f"\n❌ Encontrados {len(errors)} erros:")
    for error in errors[:10]:  # Mostrar apenas os primeiros 10
        print(f"  - {error}")
    if len(errors) > 10:
        print(f"  ... e mais {len(errors) - 10} erros")
else:
    print("\n✅ Todas as configurações são válidas!")

# Estatísticas por estado
stats = {}
for config in configs:
    state = config['id'].split('_')[0].upper()
    stats[state] = stats.get(state, 0) + 1

print("\n📈 Estatísticas por estado:")
for state in sorted(stats.keys()):
    print(f"  {state}: {stats[state]} municípios")

# Testar alguns exemplos
print("\n🔍 Exemplos de configurações:")
for state_code in ['PE', 'CE']:
    examples = [c for c in configs if c['id'].startswith(state_code.lower())][:2]
    for ex in examples:
        print(f"\n  {ex['name']}:")
        print(f"    ID: {ex['id']}")
        print(f"    IBGE: {ex['territoryId']}")
        print(f"    URL: {ex['config']['url']}")
