# Execução (`execution/`)

Este diretório guarda os **scripts determinísticos em Python** usados pelos fluxos descritos em `directives/`.

Princípios:
- Scripts devem ser **idempotentes** sempre que possível.
- Toda configuração sensível deve vir de variáveis no arquivo `.env`.
- Evite lógica de negócio complexa em prompts; coloque aqui como código testável.

Sugestão de estrutura:
- `execution/scrape_single_site.py`
- `execution/process_planilha_xls.py`
- `execution/sync_google_sheets.py`

Antes de criar um novo script, verifique se já existe algo que atenda no próprio `execution/`.

