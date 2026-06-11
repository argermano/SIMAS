# Modelos .docx — placeholders

O escritório pode cadastrar **modelos em `.docx`** (Configurações → Padrões) com a sua
formatação real (fonte, margens, cabeçalho/rodapé, logo, layout). Ao exportar com
**"Meu modelo (.docx)"**, o sistema preenche esse arquivo com os dados, preservando
**100% da formatação** (fidelidade 1:1).

Vale para: **contrato**, **procuração**, **declaração** e **substabelecimento**.

## Como funciona

1. Crie o documento no Word com a formatação desejada.
2. Onde quiser que um dado entre, escreva o placeholder entre **chaves duplas**: `{{nome_cliente}}`.
3. Salve como `.docx` e faça o upload em Configurações → Padrões (escolhendo o tipo).
4. Exporte com a opção **"Meu modelo (.docx)"**:
   - **Contrato:** na tela do contrato → menu **Assinar → Meu modelo (.docx)**.
   - **Procuração / declaração / substabelecimento:** após gerar, botão **"Meu modelo (.docx)"** no editor.

> Dica: digite cada placeholder de uma vez só (sem o corretor do Word quebrar `{{nome_cliente}}`
> no meio), senão ele pode não preencher. Se um campo não preencher, redigite-o por inteiro.
> Placeholders sem valor saem em branco (nunca aparece "undefined").

## Placeholders comuns (todos os tipos)

### Cliente
| Placeholder | Conteúdo |
|---|---|
| `{{nome_cliente}}` | Nome do cliente |
| `{{nacionalidade_cliente}}` | Nacionalidade |
| `{{estado_civil_cliente}}` | Estado civil |
| `{{profissao_cliente}}` | Profissão |
| `{{cpf_cliente}}` | CPF |
| `{{rg_cliente}}` | RG |
| `{{orgao_expedidor_cliente}}` | Órgão expedidor do RG |
| `{{endereco_cliente}}` | Endereço (logradouro) |
| `{{bairro_cliente}}` | Bairro |
| `{{cidade_cliente}}` | Cidade |
| `{{estado_cliente}}` | Estado (UF) |
| `{{cep_cliente}}` | CEP |
| `{{telefone_cliente}}` | Telefone |
| `{{email_cliente}}` | E-mail |

### Advogado / escritório
| Placeholder | Conteúdo |
|---|---|
| `{{escritorio}}` | Nome do escritório |
| `{{nome_advogado}}` | Nome do responsável |
| `{{oab}}` | OAB completa (ex.: `12345/SP`) |
| `{{numero_oab}}` | Número da OAB (sem UF) |
| `{{estado_oab}}` | Seccional/UF da OAB |
| `{{cpf_advogado}}` | CPF do responsável |
| `{{rg_advogado}}` | RG do responsável |
| `{{estado_civil_advogado}}` | Estado civil |
| `{{nacionalidade_advogado}}` | Nacionalidade |
| `{{endereco_escritorio}}` | Endereço do escritório |
| `{{cidade_escritorio}}` | Cidade do escritório |
| `{{estado_escritorio}}` | Estado do escritório (UF) |
| `{{email_advogado}}` | E-mail profissional |
| `{{telefone_advogado}}` | Telefone profissional |

### Geral
| Placeholder | Conteúdo |
|---|---|
| `{{data}}` ou `{{data_extenso}}` | Data de hoje por extenso (ex.: `11 de junho de 2026`) |
| `{{cidade}}` | Cidade para o fecho (cidade do cliente ou do escritório) |

## Placeholders específicos por tipo

### Contrato
| Placeholder | Conteúdo |
|---|---|
| `{{titulo}}` | Título do contrato |
| `{{area}}` | Área jurídica |
| `{{valor_fixo}}` | Valor fixo formatado (ex.: `5.000,00`) |
| `{{percentual_exito}}` | Percentual de êxito (ex.: `20%`) |
| `{{forma_pagamento}}` | Forma de pagamento |

### Procuração
| Placeholder | Conteúdo |
|---|---|
| `{{objeto}}` | Finalidade / objeto da procuração (campo "Dados adicionais") |

### Declaração (hipossuficiência)
| Placeholder | Conteúdo |
|---|---|
| `{{renda_mensal}}` | Renda mensal informada |
| `{{numero_dependentes}}` | Número de dependentes (se informado) |

### Substabelecimento
| Placeholder | Conteúdo |
|---|---|
| `{{nome_substabelecido}}` | Nome do advogado substabelecido |
| `{{oab_substabelecido}}` | OAB do substabelecido (ex.: `12345/SP`) |
