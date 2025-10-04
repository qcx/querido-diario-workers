import requests
import json
import re
from bs4 import BeautifulSoup

# Carregar HTML salvo
with open('domsc-homepage.html', 'r', encoding='utf-8') as f:
    html = f.read()

soup = BeautifulSoup(html, 'html.parser')

# Extrair todas as prefeituras mencionadas
prefeituras_raw = re.findall(r'Prefeitura [Mm]unicipal de ([A-Za-zÀ-ÿ\s\-\']+)', html)
prefeituras = sorted(set(p.strip() for p in prefeituras_raw))

print(f"Total de prefeituras encontradas: {len(prefeituras)}")
print("\nLista de prefeituras:")
for i, p in enumerate(prefeituras[:20], 1):
    print(f"{i}. {p}")
print(f"... e mais {len(prefeituras) - 20} prefeituras")

# Salvar lista
with open('domsc-prefeituras-raw.json', 'w', encoding='utf-8') as f:
    json.dump(prefeituras, f, ensure_ascii=False, indent=2)

print(f"\nLista salva em domsc-prefeituras-raw.json")

# Agora vamos buscar os códigos IBGE de SC
print("\nBaixando lista de municípios de SC do IBGE...")

