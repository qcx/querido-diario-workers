# Relatório de Criação de Spiders - Cidades MG

**Data**: 2026-01-09  
**Status**: Em Progresso

## Cidades Solicitadas (16 cidades)

### ✅ Completadas (1/16)

1. **Campo Belo (3111200)**
   - **SpiderType**: `instar`
   - **URL**: `https://www.campobelo.mg.gov.br/portal/diario-oficial`
   - **Plataforma**: Instar
   - **Status**: ✅ Adicionado ao mg.json
   - **Config**: Instar com requiresClientRendering: true

### 🔄 Em Progresso (2/16)

2. **Igarapé (3130101)**

   - **URL identificada**: `/diario-eletronico`
   - **URL completa**: `https://www.igarape.mg.gov.br/diario-eletronico`
   - **Plataforma**: Portal Fácil/Actcon.net
   - **Status**: ⏳ Precisa criar spiderType `portalfacil`
   - **Ação necessária**: Criar spider baseado na estrutura Portal Fácil

3. **Santana do Paraíso (3158953)**
   - **URL identificada**: `/diario-eletronico/caderno/prefeitura/1`
   - **URL completa**: `https://santanadoparaiso.mg.gov.br/diario-eletronico/caderno/prefeitura/1`
   - **Plataforma**: Portal Fácil/Actcon.net
   - **Status**: ⏳ Precisa criar spiderType `portalfacil`
   - **Ação necessária**: Criar spider baseado na estrutura Portal Fácil

### 📋 Identificadas mas Requerem Investigação Adicional (4/16)

4. **Bom Despacho (3107406)**

   - **URL identificada**: `/dome`
   - **URL completa**: `https://www.bomdespacho.mg.gov.br/dome`
   - **Status**: ⏳ Precisa navegar no site para identificar plataforma

5. **João Pinheiro (3136306)**

   - **URL identificada**: `/modulos/diario_oficial/`
   - **URL completa**: `https://www.joaopinheiro.mg.gov.br/modulos/diario_oficial/`
   - **Status**: ⏳ Sistema próprio - precisa criar spiderType customizado

6. **Santos Dumont (3160702)**

   - **Plataforma identificada**: sigpub (DOEM - diariomunicipal.com.br/amm-mg)
   - **Status**: ⏳ Precisa identificar entityId para sigpub

7. **Almenara (3101706)**
   - **URL identificada**: `/diario`
   - **URL completa**: `https://www.almenara.mg.gov.br/diario`
   - **Status**: ⏳ Precisa navegar no site para identificar plataforma

### ❓ Requerem Navegação e Análise (9/16)

8. **Bocaiuva (3107307)** - Não encontrada URL do diário oficial no site principal
9. **Santa Rita do Sapucaí (3159605)** - Não encontrada URL do diário oficial
10. **Andradas (3102605)** - Não encontrada URL do diário oficial
11. **Salinas (3157005)** - Sistema próprio detectado (CSS/JS de diário oficial)
12. **Capelinha (3112307)** - Não encontrada URL do diário oficial
13. **Oliveira (3145604)** - Site React moderno, precisa investigar
14. **Visconde do Rio Branco (3172004)** - Não encontrada URL do diário oficial
15. **Brumadinho (3109006)** - Não encontrada URL do diário oficial
16. **Caeté (3110004)** - Portal Fácil detectado, precisa verificar se tem diário oficial

## Próximos Passos

### Prioridade Alta

1. **Criar SpiderType `portalfacil`**

   - Baseado na estrutura Portal Fácil/Actcon.net
   - Usar como referência: `prefeituracaratinga-spider.ts` (puppeteer com navegação)
   - Cidades que usarão: Igarapé, Santana do Paraíso

2. **Navegar e identificar plataformas das cidades restantes**

   - Usar browser automation para acessar os sites
   - Identificar estruturas HTML e padrões de URLs
   - Mapear para spiders existentes ou criar novos

3. **Adicionar configs ao mg.json**
   - Após criar/identificar os spiders necessários
   - Adicionar todas as 16 cidades

### Arquivos que Precisam Ser Modificados/Criados

1. **Novo Spider**: `src/spiders/base/portalfacil-spider.ts`

   - Interface: `PortalfacilConfig`
   - Classe: `PortalfacilSpider`

2. **Types**: `src/types/spider-config.ts`

   - Adicionar `'portalfacil'` ao union `SpiderType`
   - Adicionar `PortalfacilConfig` ao union `SpiderPlatformConfig`
   - Criar interface `PortalfacilConfig`

3. **Registry**: `src/spiders/registry.ts`

   - Adicionar case para `'portalfacil'`

4. **Registry Manager**: `src/spiders/registry-manager.ts`

   - Adicionar case para `'portalfacil'`

5. **Index**: `src/spiders/base/index.ts`

   - Exportar `PortalfacilSpider`

6. **Config**: `src/spiders/v2/configs/mg.json`
   - Adicionar todas as 16 cidades

## Observações

- Campo Belo foi adicionado com sucesso usando plataforma Instar
- Portal Fácil/Actcon é uma plataforma comum usada por várias prefeituras
- Algumas cidades podem usar sistemas próprios que requerem spiders customizados
- O processo de navegação e identificação está lento devido ao volume de sites a analisar
