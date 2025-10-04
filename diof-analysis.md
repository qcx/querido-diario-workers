# Análise da Estrutura DIOF

## Plataforma

DIOF (Diário Oficial) - Sistema usado por 22 municípios brasileiros.

## Domínios

- `diario.{cidade}.{uf}.gov.br` - Frontend direto
- `sai.io.org.br` - Frontend alternativo (Sistema SAI)
- `dom.imap.org.br` - Frontend alternativo (Sistema IMAP)
- `diof.io.org.br/api` - API centralizada

## Fluxo de Funcionamento

### Passo 1: Obter Client ID

Existem 3 formas de obter o `client_id`:

1. **Site direto** (`diario.{cidade}.{uf}.gov.br`):
   - Fazer GET para `https://diof.io.org.br/api/dados-cliente/info/`
   - Headers necessários: `Origin`, `Referer` (apontando para o site da cidade)
   - Resposta: `{"cod_cliente": "123"}`

2. **Site SAI** (`sai.io.org.br`):
   - Fazer GET para a página principal
   - Extrair `client_id` do iframe: `<iframe src="...?c={client_id}">`

3. **Site IMAP** (`dom.imap.org.br`):
   - Fazer GET para a página principal
   - Extrair `client_id` da URL: `?varCodigo={client_id}`

### Passo 2: Buscar Diários por Período

- **Endpoint**: `https://diof.io.org.br/api/diario-oficial/edicoes-anteriores-group`
- **Método**: POST (JSON)
- **Body**:
```json
{
  "cod_cliente": "123",
  "dat_envio_ini": "2025-09-01",
  "dat_envio_fim": "2025-09-30",
  "des_observacao": "",
  "edicao": null
}
```

### Passo 3: Resposta da API

```json
[
  {
    "elements": [
      {
        "dat_envio": "2025-10-02T00:00:00",
        "des_arquivoa4": "caminho/para/arquivo",
        "cod_documento": "2548"
      }
    ]
  }
]
```

### Passo 4: Download do PDF

Duas opções de URL (tentar primeira, se falhar usar segunda):

1. **Nova API**: `https://diof.io.org.br/api/diario-oficial/download/{des_arquivoa4}.pdf`
2. **API antiga (fallback)**: `https://sai.io.org.br/Handler.ashx?f=diario&query={cod_documento}&c={cod_cliente}&m=0`

## Características

- Usa janelas mensais para buscar diários (evita sobrecarga)
- Suporta múltiplos frontends (direto, SAI, IMAP)
- Tem fallback para URLs antigas
- API centralizada facilita implementação

## Exemplos de Cidades

- Igaci/AL: `https://diario.igaci.al.gov.br` (client_id precisa ser extraído)
- Abaré/BA: `https://sai.io.org.br/ba/abare/site/diariooficial`
- Adustina/BA: `https://diario.adustina.ba.gov.br`
