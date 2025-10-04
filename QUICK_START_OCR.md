# Guia Rápido - Deploy do Sistema OCR

## 🚀 Deploy em 5 Passos

### 1. Criar Filas no Cloudflare

```bash
# Criar fila de OCR
npm run queue:create:ocr

# Criar fila de dead letter
npm run queue:create:ocr:dlq
```

**Saída esperada:**
```
✅ Created queue gazette-ocr-queue
✅ Created queue gazette-ocr-dlq
```

### 2. (Opcional) Criar KV Namespace

```bash
# Para desenvolvimento
wrangler kv:namespace create "OCR_RESULTS"

# Copiar o ID e atualizar wrangler-ocr.jsonc
```

**Atualizar em `wrangler-ocr.jsonc`:**
```jsonc
"kv_namespaces": [
  {
    "binding": "OCR_RESULTS",
    "id": "SEU_KV_NAMESPACE_ID_AQUI"  // ← Cole o ID aqui
  }
]
```

### 3. Configurar API Key do Mistral

```bash
# Adicionar secret
wrangler secret put MISTRAL_API_KEY --config wrangler-ocr.jsonc

# Quando solicitado, cole sua API key do Mistral
```

**Como obter API key:**
1. Acesse https://console.mistral.ai/
2. Vá em "API Keys"
3. Crie uma nova key
4. Copie e cole no comando acima

### 4. Deploy dos Workers

```bash
# Deploy do worker principal (crawler)
npm run deploy

# Deploy do OCR worker
npm run deploy:ocr
```

**Saída esperada:**
```
✅ Deployed querido-diario-worker
✅ Deployed querido-diario-ocr-worker
```

### 5. Testar o Sistema

```bash
# Enviar uma mensagem de teste para o crawler
wrangler queues producer send gazette-crawl-queue \
  --body '{
    "spiderId": "sp_sao_paulo",
    "territoryId": "3550308",
    "spiderType": "sigpub",
    "dateRange": {
      "start": "2025-10-01",
      "end": "2025-10-04"
    },
    "config": {
      "type": "sigpub",
      "url": "https://www.diariomunicipal.com.br/apesp/",
      "entityId": "3550308"
    }
  }'
```

## 📊 Monitorar Execução

### Ver Logs do OCR Worker

```bash
wrangler tail --config wrangler-ocr.jsonc
```

### Ver Logs do Crawler

```bash
wrangler tail --config wrangler.jsonc
```

### Verificar Filas no Dashboard

1. Acesse https://dash.cloudflare.com/
2. Vá em "Workers & Pages"
3. Clique em "Queues"
4. Veja as filas `gazette-ocr-queue` e `gazette-ocr-dlq`

## 🔍 Verificar Resultados

### Se KV está configurado:

```bash
# Listar todas as chaves
wrangler kv:key list --namespace-id SEU_KV_NAMESPACE_ID

# Ver resultado específico
wrangler kv:key get "ocr:3550308_2025-10-04_1234_1759594191712" \
  --namespace-id SEU_KV_NAMESPACE_ID
```

### Nos Logs:

```bash
# Filtrar logs de sucesso
wrangler tail --config wrangler-ocr.jsonc | grep "completed successfully"

# Filtrar logs de erro
wrangler tail --config wrangler-ocr.jsonc | grep "ERROR"
```

## 🛠️ Troubleshooting

### Problema: "Queue not found"

**Solução:** Criar as filas novamente
```bash
npm run queue:create:ocr
npm run queue:create:ocr:dlq
```

### Problema: "Unauthorized" ao chamar Mistral API

**Solução:** Verificar se a API key está configurada
```bash
# Reconfigurar secret
wrangler secret put MISTRAL_API_KEY --config wrangler-ocr.jsonc
```

### Problema: Timeout ao processar PDF

**Solução:** Aumentar timeout em `src/services/mistral-ocr.ts`
```typescript
new MistralOcrService({
  apiKey: env.MISTRAL_API_KEY,
  timeout: 120000,  // Aumentar para 2 minutos
});
```

### Problema: Mensagens indo para DLQ

**Solução:** Verificar logs de erro
```bash
wrangler tail --config wrangler-ocr.jsonc | grep "ERROR"

# Reprocessar mensagens da DLQ
wrangler queues consumer dlq retry gazette-ocr-dlq
```

## 📈 Próximos Passos

1. ✅ Sistema deployado
2. ⏳ Monitorar primeiros processamentos
3. ⏳ Ajustar batch size e timeout conforme necessário
4. ⏳ Configurar alertas no Cloudflare
5. ⏳ Integrar com banco de dados para persistência

## 💡 Dicas

- **Desenvolvimento Local:** Use `npm run dev:ocr` para testar localmente
- **Custos:** Monitore uso da API Mistral no dashboard deles
- **Performance:** Ajuste `max_batch_size` em `wrangler-ocr.jsonc` conforme necessário
- **Logs:** Use `wrangler tail` para debug em tempo real

## 📞 Suporte

- Documentação completa: `OCR_SYSTEM_DOCUMENTATION.md`
- Testes: `npx tsx test-ocr-system.ts`
- Issues: https://github.com/qcx/querido-diario-workers/issues

---

**Pronto! Seu sistema OCR está funcionando! 🎉**
