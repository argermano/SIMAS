# Integração Banco Inter — BolePix v3 + Extrato (INERTE)

Biblioteca-cliente tipada da API do Banco Inter (conta PJ do escritório) para
**emitir boleto/Pix (BolePix v3)**, **consultar/cancelar cobranças** e **ler o
extrato** para conciliar Pix recebidos por chave estática.

> **Estado atual: INERTE.** A integração foi criada no Internet Banking mas está
> **em validação no banco** — ainda **não há credenciais**. Nada aqui é chamado
> por código de produção. Enquanto as envs não entram, `estaConfigurado()` é
> `false` e toda função retorna `{ ok: false }` sem tocar a rede. Ligar só depois
> de credenciais reais **testadas no sandbox** (ver checklist no fim).

Tudo aqui é **server-only** e roda **apenas em runtime nodejs** (usa `node:https`
para o mTLS; quebraria no edge). Qualquer rota que venha a chamar esta lib deve
declarar `export const runtime = 'nodejs'`.

## Envs (cofre da Vercel — NUNCA hardcode)

| Env | Obrigatória | O que é |
| --- | --- | --- |
| `INTER_CLIENT_ID` | sim | client_id da aplicação (OAuth) |
| `INTER_CLIENT_SECRET` | sim | client_secret da aplicação (OAuth) |
| `INTER_CERT_BASE64` | sim | base64 do `.crt` do cliente (mTLS) |
| `INTER_KEY_BASE64` | sim | base64 do `.key` do cliente (mTLS) |
| `INTER_CONTA_CORRENTE` | não | nº da conta; vira header `x-conta-corrente` quando setada |
| `INTER_AMBIENTE` | não | `sandbox` \| `producao` (default `producao`) |
| `INTER_WEBHOOK_CA_BASE64` | não | base64 do `ca.crt` do Inter — **só guardado**, uso (validar webhook) vem depois |

### Gerar o base64 do cert/key

```sh
base64 -i inter.crt | pbcopy   # cola em INTER_CERT_BASE64
base64 -i inter.key | pbcopy   # cola em INTER_KEY_BASE64
base64 -i ca.crt   | pbcopy    # cola em INTER_WEBHOOK_CA_BASE64 (guardar)
```

Cadastre cada uma como env do projeto na Vercel (Production/Preview conforme o
caso). `config.ts` valida presença e forma PEM; erros citam **qual env** falta,
nunca o conteúdo.

## Como testar (sandbox PRIMEIRO)

1. Aponte `INTER_AMBIENTE=sandbox` e use as credenciais/cert de sandbox.
2. Num script/route de runtime nodejs (nunca no client), rode uma emissão de
   teste e a consulta:

   ```ts
   import { estaConfigurado, emitirBolePix, consultarCobranca } from '@/lib/financeiro/inter'

   if (!estaConfigurado()) throw new Error('faltam envs do Inter')
   const r = await emitirBolePix({
     seuNumero: 'teste-1',
     valorCentavos: 1000, // R$ 10,00 (sistema é centavos; a lib converte na borda)
     dataVencimentoISO: '2026-12-31',
     pagador: {
       cpfCnpj: '12345678900', tipoPessoa: 'FISICA', nome: 'Fulano',
       endereco: 'Rua X, 1', cidade: 'Curitiba', uf: 'PR', cep: '80000000',
     },
   })
   // r.ok === true -> r.dados.codigoSolicitacao (uuid; guardar em parcelas.cobranca_externa_id)
   if (r.ok) console.log(await consultarCobranca(r.dados!.codigoSolicitacao))
   ```

3. Só depois de o sandbox validar, troque para `producao` e repita com valores
   simbólicos antes de ligar no fluxo real.

O token OAuth vale ~60min e o endpoint aceita ~5 req/min — a lib cacheia o token
em memória (reusa enquanto faltar >60s p/ expirar) e reautentica uma vez em 401.

## Superfície pública (`index.ts`)

- **config**: `estaConfigurado`, `envsFaltando`, `ambiente`, `baseUrl`, `contaCorrente`, `webhookCaPem`.
- **cliente**: `dispatcherMtls`, `obterToken`, `interFetch`, `ResultadoInter`.
- **boleto**: `emitirBolePix`, `consultarCobranca`, `cancelarCobranca`, `montarCorpoBolePix`, `normalizarBoleto`, `mapearSituacao`, `centavosParaReais`, `reaisParaCentavos`, tipos.
- **extrato**: `consultarExtratoCompleto`, `normalizarExtrato`, `casarComprovante`, tipos.

## Nota de implementação (mTLS sem undici)

A doc do Inter descreve o mTLS via `dispatcher` da **undici**
(`new Agent({ connect: { cert, key } })`). Neste projeto a undici **não é
importável** (não é builtin público do Node nem está em `node_modules`, e não
adicionamos dependências). Usamos o equivalente **nativo e sem dependências**:
um `https.Agent({ cert, key })` (`node:https`), que faz a mesma autenticação por
certificado de cliente. Por isso `interFetch` usa `https.request` em vez do
`fetch` global (que não aceita um `Agent` nativo como dispatcher). A função
mantém o nome `dispatcherMtls()`.

## Checklist para LIGAR (depois, com credenciais reais)

Nada disto existe ainda — é a lista do que construir quando as credenciais
entrarem e o sandbox validar:

- [ ] **Emitir boleto na criação da parcela**: chamar `emitirBolePix` e gravar o
      `codigoSolicitacao` em `parcelas.cobranca_externa_id`. Guardar
      `linhaDigitavel`/`pixCopiaECola` da consulta para enviar ao cliente.
- [ ] **Webhook de liquidação → baixa**: registrar o webhook no Inter, validar a
      origem com `INTER_WEBHOOK_CA_BASE64`, e na notificação de `RECEBIDO`
      sugerir a baixa (mantendo a invariante do L1: **humano confirma**).
- [ ] **Cron de conferência de Pix (chave estática)**: rodar
      `consultarExtratoCompleto` (janela ≤ 90 dias) e `casarComprovante` para
      conciliar Pix recebidos que não passam por webhook — também só **sugere**.
- [ ] **Cancelamento**: expor `cancelarCobranca` onde o operador cancela a
      cobrança de uma parcela.

Até que esses itens existam, esta lib fica **isolada**: nenhum código que roda
hoje a importa.
