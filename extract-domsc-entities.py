import requests
import json
import re

# Tentar buscar por "Prefeitura" e extrair todas as opções do autocomplete
url = "https://diariomunicipal.sc.gov.br/"

# Fazer requisição para ver se há API de autocomplete
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

response = requests.get(url, headers=headers)
html = response.text

# Procurar por dados JavaScript que possam conter lista de entidades
# Padrões comuns: var entities = [...], window.entities = [...], etc.
patterns = [
    r'var\s+\w*entidades?\w*\s*=\s*(\[.*?\]);',
    r'window\.\w*entidades?\w*\s*=\s*(\[.*?\]);',
    r'const\s+\w*entidades?\w*\s*=\s*(\[.*?\]);',
]

print("Buscando dados de entidades no HTML...")
print(f"Tamanho do HTML: {len(html)} bytes")

# Procurar por "Prefeitura Municipal" no HTML
prefeituras = re.findall(r'Prefeitura [Mm]unicipal de ([A-Za-zÀ-ÿ\s]+)', html)
print(f"\nEncontradas {len(set(prefeituras))} menções a prefeituras no HTML")
print("Primeiras 10:", list(set(prefeituras))[:10])

# Salvar HTML para análise
with open('domsc-homepage.html', 'w', encoding='utf-8') as f:
    f.write(html)
print("\nHTML salvo em domsc-homepage.html")

