# Modelo de contrato em .docx — placeholders

O escritório pode cadastrar um **modelo de contrato em `.docx`** (Configurações → Padrões,
tipo "contrato") com a sua formatação real (fonte, margens, cabeçalho/rodapé, logo, layout).
Ao exportar um contrato com **"Meu modelo (.docx)"**, o sistema preenche esse arquivo com os
dados do contrato, preservando **100% da formatação** (fidelidade 1:1).

## Como funciona

1. Crie o seu contrato no Word com a formatação desejada.
2. Onde quiser que um dado entre, escreva o placeholder entre **chaves duplas**: `{{nome_cliente}}`.
3. Salve como `.docx` e faça o upload em Configurações → Padrões (tipo "contrato").
4. Na tela de um contrato, use **Assinar → Meu modelo (.docx)** para baixar o `.docx` preenchido.

> Dica: digite cada placeholder de uma vez só (sem corretor automático no meio), para o Word
> não quebrar `{{nome_cliente}}` em pedaços. Se um campo não preencher, redigite-o por inteiro.
> Placeholders sem valor cadastrado saem em branco (não aparece "undefined").

## Placeholders disponíveis

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
| `{{oab}}` | OAB (número/UF) |
| `{{cpf_advogado}}` | CPF do responsável |
| `{{rg_advogado}}` | RG do responsável |
| `{{estado_civil_advogado}}` | Estado civil |
| `{{nacionalidade_advogado}}` | Nacionalidade |
| `{{endereco_escritorio}}` | Endereço do escritório |
| `{{cidade_escritorio}}` | Cidade do escritório |
| `{{estado_escritorio}}` | Estado do escritório (UF) |
| `{{email_advogado}}` | E-mail profissional |
| `{{telefone_advogado}}` | Telefone profissional |

### Contrato
| Placeholder | Conteúdo |
|---|---|
| `{{titulo}}` | Título do contrato |
| `{{area}}` | Área jurídica |
| `{{valor_fixo}}` | Valor fixo (formatado, ex.: `5.000,00`) |
| `{{percentual_exito}}` | Percentual de êxito (ex.: `20%`) |
| `{{forma_pagamento}}` | Forma de pagamento |
| `{{data}}` | Data de hoje por extenso (ex.: `11 de junho de 2026`) |
| `{{cidade}}` | Cidade para o fecho (cidade do cliente ou do escritório) |
