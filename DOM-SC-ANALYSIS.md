# Análise do DOM/SC - Diário Oficial dos Municípios de Santa Catarina

## Observações da Estrutura do Site

### URL Base
- https://diariomunicipal.sc.gov.br/

### Sistema de Busca
O site possui um sistema de autocomplete para entidades que mostra:
- Municípios (prefeituras)
- Câmaras Municipais
- Consórcios Intermunicipais
- Fundações
- Institutos
- Outros órgãos públicos

Exemplo de entidades encontradas para "Florianópolis":
- Câmara Municipal de Florianópolis
- CIS-GRANFPOLIS - Consórcio Público Interfederativo de Saúde da Região da Grande Florianópolis
- Consórcio Intermunicipal Multifinalitário da Grande Florianópolis - CIM-GRANFPOLIS
- Fundação Cultural de Florianópolis Franklin Cascaes
- Instituto de Geração de Oportunidades de Florianópolis
- Instituto de Pesquisa e Planejamento Urbano de Florianópolis
- Instituto de Previdência dos Servidores Municipais de Florianópolis
- Prefeitura municipal de Florianópolis

### Campos de Pesquisa Avançada
1. **Termo de busca**: Campo de texto livre
2. **Entidade**: Autocomplete com lista de entidades
3. **Categorias**: Checkboxes para filtrar por tipo de publicação (Leis, Decretos, Licitações, etc.)
4. **Excluir termos**: Campo para termos negativos
5. **Data ou Nº da edição**: Campo para número específico
6. **Código do Ato**: Campo para código
7. **Período**: Data inicial e data final

### Estrutura de URLs
Preciso investigar mais para entender:
- Como são formadas as URLs de busca
- Como acessar PDFs diretamente
- Como identificar o entityId de cada município

### Próximos Passos
1. Fazer uma busca real e analisar a URL gerada
2. Ver como os resultados são apresentados
3. Identificar URLs dos PDFs
4. Extrair lista completa de municípios (talvez via API ou scraping)
