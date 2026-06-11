/**
 * Validação determinística da FORMATAÇÃO de uma peça (não altera o conteúdo).
 * Roda sobre o markdown e retorna avisos estruturais — complementa a validação
 * por IA (coerência/fontes) com checagens objetivas das regras forenses.
 */

export type Severidade = 'erro' | 'aviso'

export interface AvisoFormatacao {
  tipo: string
  mensagem: string
  severidade: Severidade
}

const RE_ENDERECAMENTO = /EXCELENT[IÍ]SSIMO|EGR[EÉ]GIO|COLENDO|MERIT[IÍ]SSIMO|SENHOR\s+DOUTOR|SENHOR\(A\)/i
const RE_DIVISORIA = /^\s*(-{3,}|_{3,}|\*{3,})\s*$/

export function validarFormatacaoPeca(markdown: string): AvisoFormatacao[] {
  const avisos: AvisoFormatacao[] = []
  const texto = markdown ?? ''
  const linhas = texto.split('\n')

  // 1. Endereçamento no preâmbulo (primeiras linhas com conteúdo)
  const inicio = linhas.filter((l) => l.trim()).slice(0, 8).join('\n')
  if (!RE_ENDERECAMENTO.test(inicio)) {
    avisos.push({ tipo: 'enderecamento', severidade: 'aviso', mensagem: 'Endereçamento ao juízo não identificado no início da peça.' })
  }

  // 2. Títulos com numeração arábica (devem ser romanos)
  for (const raw of linhas) {
    const l = raw.trim()
    const m = l.match(/^(?:#{2,3}\s+)?\*{0,2}\s*(\d+)(?:\.\d+)*\s*[–\-.]/)
    if (m && (l.startsWith('#') || l.startsWith('**'))) {
      avisos.push({ tipo: 'titulo_arabico', severidade: 'erro', mensagem: `Título com numeração arábica (use romana): "${l.replace(/\*/g, '').slice(0, 60)}"` })
    }
  }

  // 3. Linhas divisórias (proibidas em peças)
  if (linhas.some((l) => RE_DIVISORIA.test(l))) {
    avisos.push({ tipo: 'divisoria', severidade: 'erro', mensagem: 'Linha divisória (--- / ___ / ***) encontrada — proibida em peças.' })
  }

  // 4. Negrito desbalanceado (contagem ímpar de **)
  const negritos = (texto.match(/\*\*/g) ?? []).length
  if (negritos % 2 !== 0) {
    avisos.push({ tipo: 'negrito_desbalanceado', severidade: 'aviso', mensagem: 'Marcação de negrito (**) possivelmente desbalanceada.' })
  }

  // 5. Campos [PREENCHER] pendentes
  const preencher = (texto.match(/\[PREENCHER\]/g) ?? []).length
  if (preencher > 0) {
    avisos.push({ tipo: 'preencher', severidade: 'aviso', mensagem: `${preencher} campo(s) [PREENCHER] pendente(s) de preenchimento.` })
  }

  // 6. Jurisprudência marcada para conferência
  const verificar = (texto.match(/\[VERIFICAR\]/g) ?? []).length
  if (verificar > 0) {
    avisos.push({ tipo: 'verificar', severidade: 'aviso', mensagem: `${verificar} item(ns) [VERIFICAR] — confira a jurisprudência/citação.` })
  }

  // 7. Seção de pedidos
  if (!/DOS\s+PEDIDOS/i.test(texto)) {
    avisos.push({ tipo: 'pedidos', severidade: 'aviso', mensagem: 'Seção "DOS PEDIDOS" não identificada.' })
  }

  return avisos
}
