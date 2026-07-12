// Salvamento de peça no cliente com a guarda anti-encolhimento (camada C).
// Centraliza o tratamento do 409 CONTEUDO_MENOR: quando o conteúdo a salvar é
// bem menor que o rascunho já salvo, pede confirmação explícita antes de
// reenviar com `forcar: true`. Usado por todos os fluxos que persistem peça
// (geração, refino, correção e os editores).

export type SalvarPecaResultado =
  | { ok: true; versao?: number }
  | { ok: false; erro: string; cancelado?: boolean }

/**
 * POST /api/ia/salvar-peca tratando o 409 anti-encolhimento. Em conteúdo menor,
 * chama `confirmar` (por padrão window.confirm); só reenvia com forçar quando o
 * usuário confirma, caso contrário devolve { ok:false, cancelado:true }.
 */
export async function salvarPecaComGuarda(params: {
  pecaId: string
  conteudo: string
  /** Autosave não versiona e não passa pela guarda no servidor. */
  semVersao?: boolean
  /** Injetável para teste; padrão é window.confirm. */
  confirmar?: (mensagem: string) => boolean
}): Promise<SalvarPecaResultado> {
  const confirmar = params.confirmar ?? ((m: string) => window.confirm(m))

  const post = (forcar: boolean) =>
    fetch('/api/ia/salvar-peca', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pecaId: params.pecaId,
        conteudo: params.conteudo,
        semVersao: params.semVersao,
        forcar,
      }),
    })

  try {
    let res = await post(false)

    if (res.status === 409) {
      const data = await res.json().catch(() => null)
      const det = data?.detalhes as { code?: string; atual?: number; novo?: number } | undefined
      if (det?.code === 'CONTEUDO_MENOR') {
        const atual = (det.atual ?? 0).toLocaleString('pt-BR')
        const novo = (det.novo ?? params.conteudo.length).toLocaleString('pt-BR')
        const msg = `O texto que você está salvando tem ${novo} caracteres; o rascunho salvo tem ${atual}. Salvar assim mesmo substitui a versão maior.`
        if (!confirmar(msg)) return { ok: false, erro: 'Salvamento cancelado.', cancelado: true }
        res = await post(true)
      }
    }

    if (res.ok) {
      const data = await res.json().catch(() => ({}))
      return { ok: true, versao: data.versao }
    }
    const data = await res.json().catch(() => ({}))
    return { ok: false, erro: data.error ?? 'Falha ao salvar a peça' }
  } catch {
    return { ok: false, erro: 'Falha de rede ao salvar a peça' }
  }
}
