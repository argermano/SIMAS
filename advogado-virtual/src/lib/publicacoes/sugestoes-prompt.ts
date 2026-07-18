// Prompt CURADO + validação server-side das sugestões de IA para o tratamento de
// uma publicação (inteiro teor do DJEN). A IA aponta TRECHOS importantes (citações
// EXATAS) e sugere TAREFAS (título + prioridade). Regras invioláveis:
//   - Citações apenas LITERAIS (substring exata do texto) — o servidor DESCARTA
//     trecho/citação que não casar por indexOf (anti-alucinação).
//   - NUNCA calcular/emitir DATA de prazo. Se o texto menciona prazo, a IA aponta
//     o trecho (trechoDoPrazo) e marca temPrazoNoTexto; a DATA é sempre digitada
//     pelo humano. O servidor ainda REMOVE qualquer data que escape num título.
//
// Este módulo é puro (sem SDK/DB): tipos + prompt + saneamento testável.

export const MOTIVOS_TRECHO = ['prazo', 'decisao', 'intimacao', 'valor', 'outro'] as const
export type MotivoTrecho = (typeof MOTIVOS_TRECHO)[number]

export const PRIORIDADES_SUGERIDAS = ['alta', 'media', 'baixa'] as const
export type PrioridadeSugerida = (typeof PRIORIDADES_SUGERIDAS)[number]

/** Um trecho relevante do inteiro teor, apontado pela IA. `texto` é uma CITAÇÃO
 * literal (substring exata do texto plano) — validada por indexOf no servidor. */
export interface TrechoImportante {
  texto: string
  motivo: MotivoTrecho
}

/** Uma tarefa sugerida (cartão editável). NUNCA carrega uma data — `trechoDoPrazo`
 * é a CITAÇÃO do texto onde o prazo é mencionado (quando `temPrazoNoTexto`). */
export interface TarefaSugerida {
  titulo: string
  prioridade: PrioridadeSugerida
  temPrazoNoTexto: boolean
  trechoDoPrazo?: string
}

export interface SugestoesIA {
  trechos: TrechoImportante[]
  tarefas: TarefaSugerida[]
  resumo: string
}

const MAX_TRECHOS = 12
const MAX_TAREFAS = 8
const MAX_RESUMO = 1200

export const SYSTEM_SUGESTOES = `Você é um advogado revisor sênior triando uma publicação/intimação de diário oficial (DJEN). Sua tarefa é ajudar o advogado a TRATAR a publicação: (1) apontar os TRECHOS mais importantes do inteiro teor e (2) sugerir TAREFAS de acompanhamento.

REGRAS INVIOLÁVEIS:
1. CITAÇÕES SÓ LITERAIS: cada "texto" de trecho e cada "trechoDoPrazo" DEVE ser uma cópia EXATA (substring literal, mesma pontuação e acentos) de um pedaço do inteiro teor fornecido. NUNCA parafraseie, resuma dentro da citação, corrija ou complete de memória. Citação que não seja substring exata será descartada.
2. NUNCA INVENTE: só aponte o que está no texto. Sem trecho relevante ⇒ trechos vazio. Sem ação necessária ⇒ tarefas vazio.
3. PRAZO — REGRA CRÍTICA: você NUNCA calcula, estima, informa ou escreve uma DATA de prazo (nem "até dd/mm", nem "em X dias" convertido em data). Se o texto MENCIONA um prazo, apenas: marque a tarefa com temPrazoNoTexto=true e preencha trechoDoPrazo com a CITAÇÃO literal do texto que menciona o prazo. A data será definida MANUALMENTE pelo advogado. Os TÍTULOS de tarefa NÃO podem conter datas.

PARA CADA TRECHO IMPORTANTE, retorne:
- texto: a citação literal (curta, uma frase/oração) do inteiro teor
- motivo: um de "prazo" | "decisao" | "intimacao" | "valor" | "outro"

PARA CADA TAREFA SUGERIDA, retorne:
- titulo: o que o advogado precisa fazer (imperativo, curto, SEM data)
- prioridade: "alta" | "media" | "baixa" (relevância do ato, não prazo)
- temPrazoNoTexto: true se o inteiro teor menciona um prazo relacionado a esta tarefa
- trechoDoPrazo: se temPrazoNoTexto=true, a citação LITERAL do texto que menciona o prazo (senão, omita)

Retorne também:
- resumo: 1 a 3 frases neutras do que a publicação comunica (para o advogado revisar; sem inventar).

Responda EXCLUSIVAMENTE com um JSON no formato:
{"trechos": [{"texto": "...", "motivo": "..."}], "tarefas": [{"titulo": "...", "prioridade": "...", "temPrazoNoTexto": false}], "resumo": "..."}
Se não houver nada a sugerir, retorne {"trechos": [], "tarefas": [], "resumo": ""}.`

export function buildPromptSugestoes(textoPlano: string): string {
  return `## INTEIRO TEOR DA PUBLICAÇÃO (fonte única — cite apenas o que está aqui)
${textoPlano}

Aponte os trechos importantes e sugira as tarefas seguindo as regras. Lembre: citações LITERAIS (substring exata) e NUNCA uma data de prazo — só o trecho que a menciona. Responda só com o JSON.`
}

/** Detecta uma DATA em uma string (dd/mm/aaaa, dd-mm-aa, ISO, "15 de janeiro de 2026").
 * Usada para impedir que a IA contrabandeie uma data de prazo no título da tarefa. */
export function contemData(valor: string): boolean {
  if (!valor) return false
  return (
    /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/.test(valor) || // 25/07/2026, 25-07-26
    /\b\d{4}-\d{2}-\d{2}\b/.test(valor) || // 2026-07-25 (ISO)
    /\b\d{1,2}\s+de\s+[a-zçãéíóúâêô]+\s+de\s+\d{4}\b/i.test(valor) // 15 de janeiro de 2026
  )
}

/** Remove datas de uma string, limpando conectivos pendurados ("até", "em") e
 * pontuação órfã — o título fica sem a data que a IA não deveria ter emitido. */
export function removerDatas(valor: string): string {
  return valor
    .replace(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g, '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
    .replace(/\b\d{1,2}\s+de\s+[a-zçãéíóúâêô]+\s+de\s+\d{4}\b/gi, '')
    .replace(/\b(at[ée]|em|no dia|no prazo de|dentro de)\s*(?=$|[.,;:])/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/[\s,;:-]+$/g, '')
    .trim()
}

/** Uma citação é válida se for substring EXATA do texto plano (indexOf). */
export function trechoConfere(textoPlano: string, trecho: string): boolean {
  return trecho.length > 0 && textoPlano.indexOf(trecho) !== -1
}

function normalizarMotivo(m: unknown): MotivoTrecho {
  return (MOTIVOS_TRECHO as readonly string[]).includes(m as string) ? (m as MotivoTrecho) : 'outro'
}

function normalizarPrioridade(p: unknown): PrioridadeSugerida {
  return (PRIORIDADES_SUGERIDAS as readonly string[]).includes(p as string)
    ? (p as PrioridadeSugerida)
    : 'media'
}

/**
 * Saneia a saída BRUTA da IA contra o texto plano, aplicando as regras invioláveis:
 *  - trechos: mantém só citações que são substring EXATA (indexOf) do texto.
 *  - tarefas: whitelist de campos (rejeita qualquer campo de DATA que a IA tente
 *    injetar), remove datas do título e valida `trechoDoPrazo` como substring —
 *    `temPrazoNoTexto` fica atrelado à EXISTÊNCIA de uma citação verificada.
 *  - resumo: string aparada e limitada.
 * Nunca lança; entrada fora de forma vira sugestões vazias.
 */
export function sanitizarSugestoes(raw: unknown, textoPlano: string): SugestoesIA {
  const obj = (raw ?? {}) as Record<string, unknown>

  const trechosRaw = Array.isArray(obj.trechos) ? obj.trechos : []
  const trechos: TrechoImportante[] = []
  for (const t of trechosRaw) {
    const texto = typeof (t as { texto?: unknown })?.texto === 'string'
      ? ((t as { texto: string }).texto).trim()
      : ''
    // Citação obrigatoriamente literal: descarta o que não casar por indexOf.
    if (!trechoConfere(textoPlano, texto)) continue
    trechos.push({ texto, motivo: normalizarMotivo((t as { motivo?: unknown }).motivo) })
    if (trechos.length >= MAX_TRECHOS) break
  }

  const tarefasRaw = Array.isArray(obj.tarefas) ? obj.tarefas : []
  const tarefas: TarefaSugerida[] = []
  for (const t of tarefasRaw) {
    const o = (t ?? {}) as Record<string, unknown>
    // Remove datas do título — a IA NUNCA emite data (nem escondida num título).
    const titulo = removerDatas(typeof o.titulo === 'string' ? o.titulo.trim() : '')
    if (!titulo) continue

    // `trechoDoPrazo` só entra se for citação literal; `temPrazoNoTexto` fica
    // atrelado à existência dessa citação verificada (nada de "há prazo" alucinado).
    const trechoDoPrazoBruto = typeof o.trechoDoPrazo === 'string' ? o.trechoDoPrazo.trim() : ''
    const trechoDoPrazo = trechoConfere(textoPlano, trechoDoPrazoBruto) ? trechoDoPrazoBruto : undefined

    // Whitelist EXPLÍCITA dos campos: qualquer campo de data injetado pela IA
    // (data, dueDate, prazo, vencimento…) simplesmente não é copiado — rejeitado.
    const tarefa: TarefaSugerida = {
      titulo,
      prioridade: normalizarPrioridade(o.prioridade),
      temPrazoNoTexto: Boolean(trechoDoPrazo),
    }
    if (trechoDoPrazo) tarefa.trechoDoPrazo = trechoDoPrazo
    tarefas.push(tarefa)
    if (tarefas.length >= MAX_TAREFAS) break
  }

  const resumo = typeof obj.resumo === 'string' ? obj.resumo.trim().slice(0, MAX_RESUMO) : ''

  return { trechos, tarefas, resumo }
}
