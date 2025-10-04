# Análise da Estrutura do Diário Oficial BA

## URL Base
https://www.diariooficialba.com.br/

## Método de Busca

### Formulário
- **Action**: https://www.diariooficialba.com.br/
- **Method**: POST
- **Campos**:
  - `cidade` (select): Nome da cidade
  - `orgao` (select): Tipo de entidade (Câmara, Prefeitura, Outros)
  - `pesquisar` (submit): Botão de pesquisa

### Observações Importantes

1. **Não há campos de data no formulário principal**
   - O formulário básico não permite filtrar por período
   - A busca é feita apenas por cidade e tipo de órgão

2. **Sistema usa POST, não GET**
   - Não é possível fazer busca via query string na URL
   - Necessário simular POST request ou usar browser automation

3. **Possíveis Abordagens**:
   
   **Opção A - POST Request**:
   ```
   POST https://www.diariooficialba.com.br/
   Content-Type: application/x-www-form-urlencoded
   
   cidade=SALVADOR&orgao=Prefeitura&pesquisar=Pesquisar
   ```
   
   **Opção B - Browser Automation**:
   - Selecionar cidade no dropdown
   - Selecionar tipo de órgão
   - Clicar em "Pesquisar"
   - Extrair resultados da página de resposta

4. **Estrutura de Resultados**:
   - Após POST, o site retorna página com resultados
   - Resultados podem conter links para PDFs ou páginas de detalhes
   - Necessário investigar estrutura da página de resultados

## Próximos Passos

1. Testar POST request manualmente
2. Verificar estrutura da página de resultados
3. Identificar como acessar PDFs dos diários
4. Atualizar spider para usar POST ou browser automation
5. Verificar se há API ou método alternativo de acesso

## Recomendação

O spider atual usa GET com query string, mas o site requer POST. 
Duas soluções possíveis:

1. **Modificar spider para usar POST requests** (mais eficiente)
2. **Usar browser automation** (mais robusto, mas mais lento)

Para um sistema de produção, recomenda-se investigar se o site tem:
- API documentada
- RSS feed
- Página de listagem de edições por município
