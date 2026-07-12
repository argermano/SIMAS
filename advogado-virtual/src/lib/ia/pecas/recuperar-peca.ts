// Recuperação pós-queda (camada B): quando o stream do cliente termina
// incompleto (conexão caiu) mas o servidor continua gerando e salva o texto
// completo pela rede de segurança (salvarPecaPosStreamSeVazia no motor), este
// polling do GET /api/pecas/[id] espera o conteúdo íntegro aparecer e
// estabilizar. O servidor ainda pode estar gerando por vários minutos.

export type ResultadoRecuperacao =
  | { ok: true; conteudo: string }
  | { ok: false; motivo: 'timeout' | 'cancelado' }

function esperar(ms: number, sinal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (sinal.aborted) return resolve()
    const t = setTimeout(resolve, ms)
    sinal.addEventListener('abort', () => { clearTimeout(t); resolve() }, { once: true })
  })
}

/**
 * Faz polling da peça até o conteúdo salvo no servidor:
 * (1) estar não-vazio, (2) estar estável (duas leituras seguidas do mesmo
 * tamanho — o servidor já terminou de gravar) e (3) ser maior que o parcial já
 * exibido na tela. Devolve timeout se nada disso ocorrer dentro do teto.
 */
export async function recuperarPecaCompleta(params: {
  pecaId: string
  /** Tamanho do parcial já mostrado — só aceita conteúdo estritamente maior. */
  tamanhoParcial: number
  sinal: AbortSignal
  intervaloMs?: number
  tetoMs?: number
}): Promise<ResultadoRecuperacao> {
  const intervalo = params.intervaloMs ?? 5000
  const teto = params.tetoMs ?? 6 * 60 * 1000
  const inicio = Date.now()
  let tamanhoAnterior = -1

  while (Date.now() - inicio < teto) {
    await esperar(intervalo, params.sinal)
    if (params.sinal.aborted) return { ok: false, motivo: 'cancelado' }

    let conteudo = ''
    try {
      const res = await fetch(`/api/pecas/${params.pecaId}`, { signal: params.sinal })
      if (!res.ok) continue
      const data = await res.json()
      conteudo = (data.peca?.conteudo_markdown ?? '') as string
    } catch {
      if (params.sinal.aborted) return { ok: false, motivo: 'cancelado' }
      continue // rede instável — tenta de novo no próximo ciclo
    }

    const tamanho = conteudo.length
    if (tamanho > 0 && tamanho === tamanhoAnterior && tamanho > params.tamanhoParcial) {
      return { ok: true, conteudo }
    }
    tamanhoAnterior = tamanho
  }

  return { ok: false, motivo: 'timeout' }
}
