# Análise da Estrutura DOSP

## Plataforma

DOSP (Diário Oficial de São Paulo) - Sistema usado por 43 municípios brasileiros.

## Domínios

- `imprensaoficialmunicipal.com.br` - Frontend
- `dosp.com.br` - API

## Fluxo de Funcionamento

1. **Página inicial**: `https://www.imprensaoficialmunicipal.com.br/{cidade}`
2. **Extração do código**: Buscar no JavaScript da página o padrão `urlapi+'.js/{code}/'+idsecao`
3. **API JSON**: `https://dosp.com.br/api/index.php/dioe.js/{code}`
4. **URL do PDF**: `https://dosp.com.br/exibe_do.php?i={base64(iddo)}.pdf`

## Estrutura da Resposta JSON

```javascript
parseResponse({
  "meta": { ... },
  "data": [
    {
      "iddo": "719590",
      "hash_do": "531b7d680e58b8e0cb1e4b8a9587de6e.pdf",
      "data": "2025-10-02",
      "ano_do": "3",
      "edicao_do": "541",
      "flag_extra": 0,
      "hora_assinou": "2025-10-02 20:39:53",
      "pgtotal": 36,
      "cadernos_texto": null,
      "assinaturadados": 1
    },
    ...
  ]
})
```

## Campos Importantes

- `iddo`: ID do diário (usado para gerar URL do PDF)
- `data`: Data no formato YYYY-MM-DD
- `edicao_do`: Número da edição
- `flag_extra`: 0 = normal, >0 = edição extra
- `pgtotal`: Total de páginas

## Geração da URL do PDF

1. Pegar o campo `iddo` (ex: "719590")
2. Converter para base64: `btoa("719590")` = "NzE5NTkw"
3. URL final: `https://dosp.com.br/exibe_do.php?i=NzE5NTkw.pdf`

## Exemplos de Cidades

- Horizonte/CE: código 687
- Itajubá/MG: código desconhecido (precisa extrair da página)
- Deodápolis/MS: código desconhecido (precisa extrair da página)
