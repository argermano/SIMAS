// Prompt CURADO + validação server-side das sugestões de IA para o tratamento de
// uma publicação (inteiro teor do DJEN). A IA aponta TRECHOS importantes (citações
// EXATAS) e sugere TAREFAS (título + prioridade). Regras invioláveis:
//   - Citações apenas LITERAIS (substring exata do texto) — o servidor DESCARTA
//     trecho/citação que não casar por indexOf (anti-alucinação).
//   - A IA PODE SUGERIR a data do prazo (decisão do dono, 2026-07-18), SEMPRE como
//     sugestão EDITÁVEL que nunca vira tarefa sem confirmação humana. A data vive
//     no campo próprio `dataSugerida` (validada server-side: formato + janela) e só
//     quando há prazo CLARO no texto (citação verificada). O TÍTULO continua SEM
//     data (o servidor remove qualquer data que escape num título).
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

/** Uma tarefa sugerida (cartão editável). `trechoDoPrazo` é a CITAÇÃO do texto onde
 * o prazo é mencionado (quando `temPrazoNoTexto`). A IA pode SUGERIR a data final do
 * prazo em `dataSugerida` (sempre editável; nunca vira tarefa sem confirmação humana)
 * e explicar a contagem em `fundamentoPrazo`. Sem prazo claro ⇒ sem dataSugerida. */
export interface TarefaSugerida {
  titulo: string
  prioridade: PrioridadeSugerida
  temPrazoNoTexto: boolean
  trechoDoPrazo?: string
  /** Data final SUGERIDA do prazo (YYYY-MM-DD), validada server-side. Ausente/null
   * quando a IA não tem certeza — a UI destaca o campo como "sugerida — confira". */
  dataSugerida?: string | null
  /** Fundamento curto da contagem usada (ex.: "15 dias úteis a partir de 18/07, art.
   * 1.003 §5º CPC") ou a razão da dúvida quando não sugere data. */
  fundamentoPrazo?: string
}

/** Versão do SHAPE do payload cacheado (`sugestoes_ia`). Bump a cada evolução do
 * formato para invalidar caches antigos: v2 introduziu `dataSugerida`/`fundamentoPrazo`
 * (v1 não tinha datas e conta como ausente ⇒ regenera na 1ª abertura). */
export const SUGESTOES_VERSAO = 2

export interface SugestoesIA {
  /** Versão do payload (= SUGESTOES_VERSAO). */
  v: number
  trechos: TrechoImportante[]
  tarefas: TarefaSugerida[]
  resumo: string
}

/** Contexto de datas da publicação para a contagem de prazo (fornecido à IA). */
export interface ContextoPrazo {
  /** Data de disponibilização no DJEN (YYYY-MM-DD). */
  dataDisponibilizacao?: string | null
  /** Data de publicação presumida — próximo dia útil (YYYY-MM-DD). */
  dataPublicacaoSugerida?: string | null
}

const MAX_TRECHOS = 12
const MAX_TAREFAS = 8
const MAX_RESUMO = 1200
const MAX_FUNDAMENTO = 240

export const SYSTEM_SUGESTOES = `Você é um advogado revisor sênior triando uma publicação/intimação de diário oficial (DJEN). Sua tarefa é ajudar o advogado a TRATAR a publicação: (1) apontar os TRECHOS mais importantes do inteiro teor e (2) sugerir TAREFAS de acompanhamento.

REGRAS INVIOLÁVEIS:
1. CITAÇÕES SÓ LITERAIS: cada "texto" de trecho e cada "trechoDoPrazo" DEVE ser uma cópia EXATA (substring literal, mesma pontuação e acentos) de um pedaço do inteiro teor fornecido. NUNCA parafraseie, resuma dentro da citação, corrija ou complete de memória. Citação que não seja substring exata será descartada.
2. NUNCA INVENTE: só aponte o que está no texto. Sem trecho relevante ⇒ trechos vazio. Sem ação necessária ⇒ tarefas vazio.
3. PRAZO — REGRA CRÍTICA: o TÍTULO da tarefa NUNCA contém data. A data de um prazo vai APENAS no campo próprio "dataSugerida" (formato YYYY-MM-DD), e SÓ quando o texto deixa o prazo CLARO:
   - Se o inteiro teor MENCIONA um prazo, marque temPrazoNoTexto=true e preencha trechoDoPrazo com a CITAÇÃO literal que o menciona.
   - CONTAGEM (regra geral): prazos processuais cíveis contam-se em DIAS ÚTEIS a partir do PRIMEIRO DIA ÚTIL SEGUINTE à data de publicação. Use a "data de publicação presumida" informada abaixo como referência do termo inicial. Se o texto indicar OUTRA contagem (dias corridos, prazo trabalhista/CLT, prazo em dobro, termo inicial diferente), siga o texto.
   - Quando conseguir contar com segurança, preencha "dataSugerida" com a data final (YYYY-MM-DD) e "fundamentoPrazo" com uma frase curta explicando a contagem (ex.: "15 dias úteis a partir de 18/07, art. 1.003 §5º CPC").
   - NA DÚVIDA (contagem ambígua, sem termo inicial claro, prazo condicional, não sabe se conta em dias úteis ou corridos): devolva dataSugerida=null e apenas o "fundamentoPrazo" explicando a dúvida. NUNCA invente uma data — sem prazo claro no texto ⇒ sem dataSugerida.
   - A data é apenas uma SUGESTÃO: o advogado confere, edita ou limpa antes de confirmar.

PARA CADA TRECHO IMPORTANTE, retorne:
- texto: a citação literal (curta, uma frase/oração) do inteiro teor
- motivo: um de "prazo" | "decisao" | "intimacao" | "valor" | "outro"

PARA CADA TAREFA SUGERIDA, retorne:
- titulo: o que o advogado precisa fazer (imperativo, curto, SEM data)
- prioridade: "alta" | "media" | "baixa" (relevância do ato, não prazo)
- temPrazoNoTexto: true se o inteiro teor menciona um prazo relacionado a esta tarefa
- trechoDoPrazo: se temPrazoNoTexto=true, a citação LITERAL do texto que menciona o prazo (senão, omita)
- dataSugerida: quando houver prazo e você contar com segurança, a data final em YYYY-MM-DD; senão null
- fundamentoPrazo: quando temPrazoNoTexto=true, uma frase curta com a contagem usada OU a razão da dúvida (senão, omita)

Retorne também:
- resumo: 1 a 3 frases neutras do que a publicação comunica (para o advogado revisar; sem inventar).

Responda EXCLUSIVAMENTE com um JSON no formato:
{"trechos": [{"texto": "...", "motivo": "..."}], "tarefas": [{"titulo": "...", "prioridade": "...", "temPrazoNoTexto": true, "trechoDoPrazo": "...", "dataSugerida": "2026-07-31", "fundamentoPrazo": "..."}], "resumo": "..."}
Se não houver nada a sugerir, retorne {"trechos": [], "tarefas": [], "resumo": ""}.`

export function buildPromptSugestoes(textoPlano: string, ctx: ContextoPrazo = {}): string {
  const disp = ctx.dataDisponibilizacao || '(não informada)'
  const pub = ctx.dataPublicacaoSugerida || '(não informada)'
  return `## DADOS DA PUBLICAÇÃO (para a contagem de prazo)
- Data de disponibilização no DJEN: ${disp}
- Data de publicação presumida (próximo dia útil): ${pub}
Termo inicial da contagem geral: primeiro dia útil SEGUINTE à data de publicação presumida.

## INTEIRO TEOR DA PUBLICAÇÃO (fonte única — cite apenas o que está aqui)
${textoPlano}

Aponte os trechos importantes e sugira as tarefas seguindo as regras. Lembre: citações LITERAIS (substring exata); o TÍTULO nunca contém data; a data do prazo vai só em "dataSugerida" (YYYY-MM-DD) e apenas com prazo claro — na dúvida, dataSugerida=null e só o fundamento. Responda só com o JSON.`
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

/**
 * Valida uma DATA sugerida de prazo pela IA. Exige:
 *  - formato YYYY-MM-DD de calendário REAL (rejeita 2026-02-30, 2026-13-01…);
 *  - dentro da janela [hoje-30d, hoje+2 anos] (a IA não fixa prazo fora do plausível).
 * Fora disso ⇒ null (o chamador mantém o fundamento, mas descarta a data). Comparação
 * em UTC (data pura), sem sofrer com fuso — a janela é folgada e não exige precisão.
 */
export function validarDataSugerida(valor: unknown, agora: Date = new Date()): string | null {
  if (typeof valor !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor.trim())
  if (!m) return null
  const ano = Number(m[1])
  const mes = Number(m[2])
  const dia = Number(m[3])
  const dt = new Date(Date.UTC(ano, mes - 1, dia))
  // Calendário real: o roundtrip precisa bater (pega mês/dia fora de faixa).
  if (dt.getUTCFullYear() !== ano || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== dia) return null
  const hoje = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate())
  const min = hoje - 30 * 86_400_000
  const max = Date.UTC(agora.getUTCFullYear() + 2, agora.getUTCMonth(), agora.getUTCDate())
  const t = dt.getTime()
  if (t < min || t > max) return null
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** O cache persistido (`sugestoes_ia`) só é aproveitável se casar com a VERSÃO atual
 * do payload — caches antigos (v1, sem dataSugerida) contam como ausentes ⇒ regeneram. */
export function cacheAtual(sugestoes: unknown): boolean {
  return (
    !!sugestoes &&
    typeof sugestoes === 'object' &&
    (sugestoes as { v?: unknown }).v === SUGESTOES_VERSAO
  )
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
 *  - tarefas: whitelist de campos (rejeita campos de DATA de NOME LIVRE que a IA
 *    tente injetar), remove datas do TÍTULO e valida `trechoDoPrazo` como substring —
 *    `temPrazoNoTexto` fica atrelado à EXISTÊNCIA de uma citação verificada. A única
 *    data aceita é `dataSugerida` (validada por formato + janela) e só quando há
 *    prazo claro; `fundamentoPrazo` é aparado.
 *  - resumo: string aparada e limitada.
 * Carimba a VERSÃO do payload (v). Nunca lança; entrada fora de forma vira sugestões
 * vazias. `agora` é injetável para tornar a janela de datas determinística nos testes.
 */
export function sanitizarSugestoes(raw: unknown, textoPlano: string, agora: Date = new Date()): SugestoesIA {
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

    // Whitelist EXPLÍCITA dos campos: campos de data de NOME LIVRE injetados pela IA
    // (data, dueDate, prazo, vencimento…) NÃO são copiados — rejeitados. A ÚNICA data
    // aceita é `dataSugerida`, e apenas quando há prazo claro (citação verificada).
    const tarefa: TarefaSugerida = {
      titulo,
      prioridade: normalizarPrioridade(o.prioridade),
      temPrazoNoTexto: Boolean(trechoDoPrazo),
    }
    if (trechoDoPrazo) {
      tarefa.trechoDoPrazo = trechoDoPrazo
      const fundamento = typeof o.fundamentoPrazo === 'string'
        ? o.fundamentoPrazo.trim().slice(0, MAX_FUNDAMENTO)
        : ''
      if (fundamento) tarefa.fundamentoPrazo = fundamento
      // Data SUGERIDA (editável; nunca vira tarefa sem confirmação humana): fora do
      // formato/janela vira null. INVARIANTE: uma data nunca aparece "nua" — só
      // acompanha um FUNDAMENTO que explique a contagem (sem fundamento ⇒ sem data).
      const dataSugerida = fundamento ? validarDataSugerida(o.dataSugerida, agora) : null
      if (dataSugerida) tarefa.dataSugerida = dataSugerida
    }
    tarefas.push(tarefa)
    if (tarefas.length >= MAX_TAREFAS) break
  }

  const resumo = typeof obj.resumo === 'string' ? obj.resumo.trim().slice(0, MAX_RESUMO) : ''

  return { v: SUGESTOES_VERSAO, trechos, tarefas, resumo }
}
