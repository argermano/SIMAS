import { NextResponse } from 'next/server'
import { getAuthContext } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { extrairTextoPlano } from '@/lib/processos/djen'

// ─────────────────────────────────────────────────────────────
// GET /api/publicacoes/[id] — detalhe de uma publicação do tenant (Lote 2)
// Deriva `textoPlano` do HTML bruto (`texto`) e expõe apenas `meta.link` — NUNCA
// devolve o `meta` completo nem o `texto` cru (HTML dos tribunais). `destinatarios`
// (coluna própria) segue no payload. 404 se a linha não for do tenant.
// Quando a publicação casou com processo cadastrado (`processo_id`), anexa
// `processoVinculado` (processo + cliente, mesmo tenant) p/ o card à direita.
// ─────────────────────────────────────────────────────────────

/** 20 dígitos → NNNNNNN-DD.AAAA.J.TR.OOOO. Devolve a entrada se não tiver 20 dígitos. */
function formatarCNJ(d: string | null | undefined): string | null {
  if (!d) return null
  const s = d.replace(/\D/g, '')
  if (s.length !== 20) return d
  return `${s.slice(0, 7)}-${s.slice(7, 9)}.${s.slice(9, 13)}.${s.slice(13, 14)}.${s.slice(14, 16)}.${s.slice(16, 20)}`
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: pub } = await supabase
    .from('publicacoes')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id) // defesa em profundidade (RLS já isola)
    .single()

  if (!pub) return jsonError('Publicação não encontrada.', 404)

  // Remove `texto` (HTML cru) e `meta` (item bruto) do payload; entrega derivados.
  const { texto, meta, ...rest } = pub as {
    texto: string | null
    meta: { link?: string | null } | null
    processo_id: string | null
  } & Record<string, unknown>
  const link = meta?.link ?? null

  // Processo VINCULADO (mesmo tenant) p/ o card à direita — null se a publicação
  // não casou com processo cadastrado. `clientes.nome` é plaintext; `numeroMascara`
  // formatado dos dígitos do CNJ.
  const processoId = (rest as { processo_id?: string | null }).processo_id ?? null
  // Shape ALINHADO ao DTO `ProcessoVinculado` do front (tipos.ts): campos planos
  // (`titulo`/`clienteId`/`clienteNome`) que o CardProcesso lê diretamente.
  let processoVinculado: {
    id: string
    numeroMascara: string | null
    titulo: string | null
    situacao: string | null
    clienteId: string | null
    clienteNome: string | null
    ultimaSincronizacao: string | null
  } | null = null
  if (processoId) {
    const { data: proc } = await supabase
      .from('processos')
      .select('id, numero_cnj, classe, situacao, ultima_sincronizacao, cliente:clientes(id, nome)')
      .eq('id', processoId)
      .eq('tenant_id', usuario.tenant_id) // defesa em profundidade (RLS já isola)
      .single()
    if (proc) {
      const p = proc as {
        id: string
        numero_cnj: string | null
        classe: string | null
        situacao: string | null
        ultima_sincronizacao: string | null
        cliente:
          | { id: string; nome: string | null }
          | { id: string; nome: string | null }[]
          | null
      }
      const cli = Array.isArray(p.cliente) ? p.cliente[0] ?? null : p.cliente
      processoVinculado = {
        id: p.id,
        numeroMascara: formatarCNJ(p.numero_cnj),
        titulo: p.classe ?? null,
        situacao: p.situacao ?? null,
        clienteId: cli?.id ?? null,
        clienteNome: cli?.nome ?? null,
        ultimaSincronizacao: p.ultima_sincronizacao ?? null,
      }
    }
  }

  return NextResponse.json({
    publicacao: {
      ...rest,
      textoPlano: extrairTextoPlano(texto),
      link,
      processoVinculado,
    },
  })
}
