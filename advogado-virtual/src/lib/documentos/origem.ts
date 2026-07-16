// Distingue a ORIGEM de um documento pelo seu caminho no Storage — sem coluna
// extra, porque os dois fluxos de upload usam prefixos fixos e distintos:
//   • dossiê do cliente → `<tenant>/clientes/<cliente>/…` (api/clientes/[id]/documentos)
//   • caso/atendimento  → `<tenant>/<atendimentoId>/docs/…` (api/atendimentos/[id]/documentos)
// Um doc "do cadastro" é o que nasceu no dossiê e foi VINCULADO a um caso: por
// isso, na tela do caso, seu X deve DESVINCULAR (voltar ao cadastro) e não
// excluir — o arquivo pertence ao cliente. Já um doc que nasceu no caso é
// excluído normalmente.
export function documentoNasceuNoCadastro(fileUrl: string | null | undefined): boolean {
  if (!fileUrl) return false
  // Segmento após o tenant. Ex.: `<tenant>/clientes/…` → 'clientes'.
  return fileUrl.split('/')[1] === 'clientes'
}
