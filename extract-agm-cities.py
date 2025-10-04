import requests
from bs4 import BeautifulSoup
import json
import re

url = "https://www.diariomunicipal.com.br/agm/pesquisar"
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
}

response = requests.get(url, headers=headers)
soup = BeautifulSoup(response.text, 'html.parser')

# Encontrar o select de municípios
select = soup.find('select')
if select:
    options = select.find_all('option')[1:]  # Pular "Selecione"
    
    municipios_agm = []
    for opt in options:
        text = opt.text.strip()
        value = opt.get('value', '')
        
        # Filtrar apenas municípios (que começam com "Município de")
        if text.startswith('Município de '):
            nome = text.replace('Município de ', '')
            municipios_agm.append({
                'nome': nome,
                'value': value,
                'text_original': text
            })
    
    print(f"Total de municípios encontrados no AGM: {len(municipios_agm)}")
    print("\nPrimeiros 10:")
    for m in municipios_agm[:10]:
        print(f"  - {m['nome']}")
    
    # Salvar
    with open('agm-municipios-raw.json', 'w', encoding='utf-8') as f:
        json.dump(municipios_agm, f, ensure_ascii=False, indent=2)
    
    print(f"\nArquivo salvo: agm-municipios-raw.json")
else:
    print("Não foi possível encontrar o select de municípios")
