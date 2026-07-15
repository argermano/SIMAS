import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { TIPOS_ANEXO_PERMITIDOS } from '@/lib/conversas/anexos'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// GET /api/conversas/documentos?clienteId=&q=&incluirPecas= — lista LEVE de itens
// do tenant que PODEM ser enviados ao cliente (só tipos da allowlist de anexo).
// Devolve id/nome/tipo/mime/tamanho, no máx. 30. Usado pelo AnexarDocumentoModal.
// (As rotas /api/documentos existentes descriptografam/pesam mais do que o picker
// precisa; por isso esta é dedicada e enxuta — igual ao /conversas/clientes.)
//
// Com ?incluirPecas=1 (usado pelo envio de anexos no atendimento) cada documento
// ganha `origem:'documento'` e são acrescentadas as PEÇAS do cliente (exportadas
// para .docx no envio). SEM a flag a resposta é idêntica à atual (compat picker).
export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate
  const { supabase, usuario } = auth

  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') ?? '').trim()
  const clienteId = (searchParams.get('clienteId') ?? '').trim()
  const incluirPecas = searchParams.get('incluirPecas') === '1'
  const clienteValido = !!clienteId && UUID_RE.test(clienteId)

  let query = supabase
    .from('documentos')
    .select('id, file_name, tipo, mime_type, tamanho_bytes')
    .eq('tenant_id', usuario.tenant_id)
    // só o que dá para enviar de fato: arquivo presente e tipo aceito.
    .not('file_url', 'is', null)
    .in('mime_type', Array.from(TIPOS_ANEXO_PERMITIDOS))
    .order('created_at', { ascending: false })
    .limit(30)
  // uuid inválido é ignorado (evita 500 no cast do Postgres).
  if (clienteValido) query = query.eq('cliente_id', clienteId)
  if (q) query = query.ilike('file_name', `%${q}%`)

  const { data, error } = await query
  if (error) return jsonError(error.message, 500)

  const documentos = (data ?? []).map((d) => ({
    id: d.id,
    nome: d.file_name,
    tipo: d.tipo,
    mime: d.mime_type,
    tamanho: d.tamanho_bytes,
    // `origem` só aparece na variante nova (compat: sem flag, forma idêntica à antiga).
    ...(incluirPecas ? { origem: 'documento' as const } : {}),
  }))

  // Sem a flag: resposta idêntica à atual.
  if (!incluirPecas) return NextResponse.json({ documentos })

  // Peças não têm cliente_id direto: o vínculo é pecas → atendimentos.cliente_id.
  // Sem cliente (ou uuid inválido) não há como filtrar, então não há peças.
  let pecasItens: Array<{
    id: string
    origem: 'peca'
    file_name: string
    tipo: 'peca'
    mime_type: 'docx'
  }> = []

  if (clienteValido) {
    const { data: pecas, error: erroPecas } = await supabase
      .from('pecas')
      .select('id, tipo, versao, atendimentos!inner(cliente_id)')
      .eq('tenant_id', usuario.tenant_id)
      .eq('atendimentos.cliente_id', clienteId)
      .not('conteudo_markdown', 'is', null) // sem conteúdo não há .docx para enviar
      .order('created_at', { ascending: false })
      .limit(30)
    if (erroPecas) return jsonError(erroPecas.message, 500)

    pecasItens = (pecas ?? []).map((p) => {
      const nomeTipo = TIPOS_PECA[p.tipo as string]?.nome ?? String(p.tipo)
      return {
        id: p.id as string,
        origem: 'peca' as const,
        file_name: `${nomeTipo} v${p.versao}`,
        tipo: 'peca' as const,
        mime_type: 'docx' as const,
      }
    })
    // Mesmo filtro textual do picker, agora sobre o nome de exibição da peça.
    if (q) {
      const alvo = q.toLowerCase()
      pecasItens = pecasItens.filter((p) => p.file_name.toLowerCase().includes(alvo))
    }
  }

  return NextResponse.json({ documentos: [...documentos, ...pecasItens] })
}
