# Análise da Estrutura HTML do Instar (Betim)

## Estrutura do Elemento de Diário Oficial

```html
<div class="dof_publicacao_diario sw_item_listagem">
    <a href="/portal/diario-oficial/ver/3877" target="_blank">
        <div class="dof_cont_publicacao_diario sw_cont_item_listagem sw_lato">
            <!-- Imagem -->
            <div class="dof_area_img_publicacao">
                <img class="imgcentraliza" src="/fotos/..." alt="Diário Oficial - Edição nº 3249">
            </div>
            
            <!-- Título -->
            <div class="dof_titulo_publicacao sw_titulo_listagem">
                <span>Edição nº 3249</span>
                <img class="dof_icp sw_txt_tooltip" src="/imgcomum/icp.svg" alt="icp" data-tooltip="Assinado Digitalmente">
            </div>
            
            <!-- Informações -->
            <span>Postagem: 02/10/2025 às 22h31</span>
            <span>Tamanho: 46,57 MB | 142 páginas</span>
            <span>Visualizações: 832</span>
        </div>
    </a>
</div>
```

## Problemas Identificados

1. **Data não está em um span direto filho**: A data está em um span que contém "Postagem:\n 02/10/2025 às 22h31"
2. **Formato da data**: A data inclui hora e está no formato "DD/MM/YYYY às HHhMM"
3. **Número da edição**: Está no título "Edição nº 3249"

## Seletores Corretos

- **Container**: `.dof_publicacao_diario`
- **Link para detalhes**: `a[href*="/portal/diario-oficial/ver/"]`
- **Título/Edição**: `.dof_titulo_publicacao span` (primeiro span)
- **Data**: Buscar em todos os spans por padrão `DD/MM/YYYY`

## Observações

- A data de postagem está visível na listagem, não precisa acessar página de detalhes
- O link direto para o PDF não está na listagem, precisa acessar a página de detalhes
- A página de detalhes tem o formato: `/portal/diario-oficial/ver/{id}`
