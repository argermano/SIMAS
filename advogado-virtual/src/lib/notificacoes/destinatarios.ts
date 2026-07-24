// Regra PURA de quem recebe o aviso de "nova tarefa": junta o responsável
// principal + os envolvidos, remove nulos, DEDUPLICA e EXCLUI quem executou a
// ação (o criador/reatribuidor nunca se auto-avisa). Zero I/O — testável.

/**
 * Destinatários únicos de um aviso de tarefa.
 * @param assigneeId responsável principal (ou null).
 * @param envolvidos responsáveis adicionais / recém-adicionados (task_assignees).
 * @param excluir quem disparou a ação (ex.: o criador) — nunca recebe.
 */
export function destinatariosNovaTarefa(args: {
  assigneeId?: string | null
  envolvidos?: (string | null | undefined)[]
  excluir?: string | null
}): string[] {
  const excluir = args.excluir ?? null
  const brutos = [args.assigneeId, ...(args.envolvidos ?? [])]
  const vistos = new Set<string>()
  const out: string[] = []
  for (const id of brutos) {
    if (!id) continue
    if (id === excluir) continue
    if (vistos.has(id)) continue
    vistos.add(id)
    out.push(id)
  }
  return out
}
