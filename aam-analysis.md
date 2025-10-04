# Análise AAM (Amazonas)

## URLs
- Principal: https://diariomunicipalaam.org.br/ (Cloudflare protection)
- Alternativa: https://www.diariomunicipal.com.br/aam/ (Funcional)

## Confirmação
**AAM usa plataforma SIGPub padrão!**

## Observações
- Total de 147 entidades no dropdown
- Inclui Câmaras e Prefeituras Municipais
- Sistema SIGPub padrão com busca por município
- Assinatura digital com certificado

## Estratégia de Implementação
Como AAM usa SIGPub, devemos:
1. Adicionar municípios ao arquivo `sigpub-cities.json` existente
2. Extrair lista completa de prefeituras do dropdown
3. Mapear para códigos IBGE do Amazonas
4. Testar com spider SIGPub existente

## Próximos Passos
1. Extrair lista completa de entidades (147 total)
2. Filtrar apenas prefeituras municipais
3. Obter códigos IBGE via API
4. Atualizar configuração SIGPub
