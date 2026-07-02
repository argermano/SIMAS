// Construtores compartilhados dos prompts curados NOVOS (réplica, apelação,
// recurso ordinário). Cada arquivo de área é um wrapper fino que injeta sua
// metadata jurídica (persona + fundamentos) — mantendo a estrutura da peça
// consistente entre áreas e a nuance jurídica visível por arquivo para a
// curadoria humana.
//
// Não altera os prompts existentes (petição inicial / contestação), que
// permanecem com sua própria implementação e estão travados por snapshot.

import { REGRAS_FORMATACAO_FORENSE, SYSTEM_REGRAS_FORENSE } from '../regras-formatacao'
import { formatarQualificacao, formatarDocumentosIntegrais, type DadosQualificacao } from './qualificacao'

export interface DadosPeca {
  analise?: Record<string, unknown>
  transcricao: string
  pedido_especifico?: string
  documentos: Array<{ tipo: string; texto_extraido: string; file_name: string }>
  localizacao?: { cidade?: string; estado?: string }
  qualificacao?: DadosQualificacao
}

export interface MetaArea {
  /** Como o advogado é descrito (ex.: 'previdenciarista', 'de família'). */
  persona: string
  /** Fundamentos legais de referência da área (ex.: 'Lei 8.213/91 e CF/88'). */
  fundamentos: string
}

const REGRAS_COMUNS = `## REGRAS
- Use APENAS fatos dos dados disponíveis
- Argumente de forma ESPECÍFICA, ponto a ponto — evite alegações genéricas
- NÃO invente jurisprudência nem números de súmula/precedente — quando citar, marque com [VERIFICAR] para conferência posterior
- Marque com [PREENCHER] dados faltantes (número do processo, comarca/vara, datas, valores)
- Linguagem técnica jurídica formal
- GERE A PEÇA COMPLETA do início ao fim, sem interrupções`

function blocoContexto(d: DadosPeca, rotuloRelato: string, rotuloPedido: string): string {
  return `## CONTEXTO
${d.analise ? `### Análise jurídica prévia:\n${JSON.stringify(d.analise, null, 2)}` : '### Sem análise prévia.'}

### ${rotuloRelato}: ${d.transcricao}
### ${rotuloPedido}: ${d.pedido_especifico || 'Nenhum.'}
### Documentos do caso (conteúdo integral):
${formatarDocumentosIntegrais(d.documentos)}
${formatarQualificacao(d.qualificacao)}`
}

// ─── Réplica (Impugnação à Contestação) — CPC arts. 341, 350 a 353 ──────────
export function construirReplica(meta: MetaArea): { system: string; build: (d: DadosPeca) => string } {
  return {
    system: `Você é um advogado ${meta.persona} sênior redigindo uma Impugnação à Contestação (Réplica). Escreva a peça COMPLETA em Markdown bem formatado, com linguagem jurídica formal e técnica, impugnando de forma específica os pontos da defesa. NUNCA interrompa a geração. ${SYSTEM_REGRAS_FORENSE}`,
    build: (d) => `
Você é um advogado ${meta.persona} experiente redigindo uma Impugnação à Contestação (Réplica).

${blocoContexto(d, 'Histórico e fatos (relato/transcrição)', 'Pontos da contestação a rebater / instruções')}

## ESTRUTURA OBRIGATÓRIA
1. Endereçamento (ao mesmo juízo da causa)
2. Referência ao processo e às partes
3. Da tempestividade da réplica (art. 350 do CPC/2015)
4. Breve síntese da contestação apresentada
5. Da impugnação às preliminares suscitadas, se houver (art. 351 do CPC/2015)
6. Da impugnação especificada dos fatos — rebater ponto a ponto (impugnação específica, nunca genérica; art. 341 do CPC/2015)
7. Da reafirmação da tese e dos fundamentos da petição inicial
8. Das provas cuja produção se pretende
9. Dos requerimentos (rejeição das preliminares, improcedência da defesa e procedência integral dos pedidos da inicial)
10. Fechamento

## FUNDAMENTOS DE REFERÊNCIA (use apenas os pertinentes ao caso concreto)
- Impugnação à contestação: arts. 341 e 350 a 353 do CPC/2015.
- Direito material da área: ${meta.fundamentos}.

${REGRAS_COMUNS}

${REGRAS_FORMATACAO_FORENSE}

Responda com a réplica COMPLETA em Markdown bem formatado. Não interrompa a geração.
`.trim(),
  }
}

// ─── Apelação — CPC arts. 1.009 a 1.014 ─────────────────────────────────────
export function construirApelacao(meta: MetaArea): { system: string; build: (d: DadosPeca) => string } {
  return {
    system: `Você é um advogado ${meta.persona} sênior redigindo um Recurso de Apelação. Escreva a peça COMPLETA (petição de interposição + razões recursais) em Markdown bem formatado, com linguagem jurídica formal e técnica. NUNCA interrompa a geração. ${SYSTEM_REGRAS_FORENSE}`,
    build: (d) => `
Você é um advogado ${meta.persona} experiente redigindo um Recurso de Apelação.

${blocoContexto(d, 'Histórico, sentença recorrida e fatos (relato/transcrição)', 'Pontos da sentença a reformar / instruções')}

## ESTRUTURA OBRIGATÓRIA

### PARTE I — Petição de Interposição (dirigida ao juízo de 1º grau que proferiu a sentença)
1. Endereçamento ao Juízo da causa (ex.: "Ao Juízo da ... Vara ... da Comarca/Seção de [PREENCHER]")
2. Referência ao processo, às partes e à sentença recorrida
3. Da tempestividade (prazo de 15 dias úteis — art. 1.003, §5º, do CPC/2015) e do preparo (art. 1.007), ou pedido de justiça gratuita
4. Requerimento de recebimento do recurso e de remessa ao Egrégio Tribunal, com as razões anexas

### PARTE II — Razões de Apelação (dirigidas ao Tribunal)
5. Endereçamento ao Egrégio Tribunal / Colenda Câmara
6. Breve síntese da demanda e da sentença recorrida
7. Das razões para a reforma — impugnação específica aos fundamentos de fato e de direito da sentença (art. 1.010, II e III, do CPC/2015)
8. Do prequestionamento dos dispositivos, se aplicável
9. Dos pedidos (conhecimento e provimento do recurso; reforma da sentença)
10. Fechamento

## FUNDAMENTOS DE REFERÊNCIA (use apenas os pertinentes ao caso concreto)
- Apelação: arts. 1.009 a 1.014 do CPC/2015; requisitos das razões no art. 1.010.
- Direito material da área: ${meta.fundamentos}.

${REGRAS_COMUNS}

${REGRAS_FORMATACAO_FORENSE}

Responda com o recurso de apelação COMPLETO (petição de interposição + razões) em Markdown bem formatado. Não interrompa a geração.
`.trim(),
  }
}

// ─── Recurso Ordinário (trabalhista) — CLT art. 895 ─────────────────────────
export function construirRecursoOrdinario(meta: MetaArea): { system: string; build: (d: DadosPeca) => string } {
  return {
    system: `Você é um advogado ${meta.persona} sênior redigindo um Recurso Ordinário trabalhista. Escreva a peça COMPLETA (petição de interposição + razões recursais) em Markdown bem formatado, com linguagem jurídica formal e técnica. NUNCA interrompa a geração. ${SYSTEM_REGRAS_FORENSE}`,
    build: (d) => `
Você é um advogado ${meta.persona} experiente redigindo um Recurso Ordinário.

${blocoContexto(d, 'Histórico, sentença recorrida e fatos (relato/transcrição)', 'Pontos da sentença a reformar / instruções')}

## ESTRUTURA OBRIGATÓRIA

### PARTE I — Petição de Interposição (dirigida à Vara do Trabalho que proferiu a sentença)
1. Endereçamento ao Juízo da Vara do Trabalho (ex.: "Ao Juízo da ... Vara do Trabalho de [PREENCHER]")
2. Referência ao processo, às partes e à sentença recorrida
3. Da tempestividade (prazo de 8 dias — art. 895 da CLT) e do preparo (custas e depósito recursal, quando exigível — art. 899 da CLT), ou pedido de justiça gratuita
4. Requerimento de recebimento do recurso e de remessa ao Egrégio Tribunal Regional do Trabalho

### PARTE II — Razões do Recurso Ordinário (dirigidas ao TRT)
5. Endereçamento ao Egrégio Tribunal Regional do Trabalho
6. Breve síntese da reclamação trabalhista e da sentença recorrida
7. Do mérito recursal — razões de reforma, ponto a ponto, impugnando os fundamentos da sentença
8. Do prequestionamento, se aplicável
9. Dos pedidos (conhecimento e provimento do recurso; reforma da sentença)
10. Fechamento

## FUNDAMENTOS DE REFERÊNCIA (use apenas os pertinentes ao caso concreto)
- Recurso Ordinário: art. 895 da CLT; preparo/depósito recursal: art. 899 da CLT.
- Direito material da área: ${meta.fundamentos}.

${REGRAS_COMUNS}

${REGRAS_FORMATACAO_FORENSE}

Responda com o recurso ordinário COMPLETO (petição de interposição + razões) em Markdown bem formatado. Não interrompa a geração.
`.trim(),
  }
}
