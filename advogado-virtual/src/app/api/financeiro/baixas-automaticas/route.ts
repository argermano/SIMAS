import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logger } from '@/lib/logger'

// GET /api/financeiro/baixas-automaticas — AVISO/painel do topo do /financeiro:
// parcelas que o SISTEMA baixou sozinho (migration 077, baixa_automatica=true)
// numa janela recente, para o dono conferir SEM caçar e DESFAZER se algo saiu
// errado. Cada item traz o comprovante em signed URL curta (inline) + os dados
// que a IA leu. Janela recente (JANELA_DIAS): uma baixa automática indevida
// aparece aqui em destaque por dias; o registro permanente (badge/DESFAZER na
// linha da parcela + audit_log) segue existindo fora da janela.
// TODA a equipe vê o painel (admin/advogado/colaborador); DESFAZER exige
// admin/advogado (rota .../desfazer-automatica). LGPD: nada de dados logado.

const ROLES = ['admin', 'advogado', 'colaborador']

// Janela do aviso (dias): baixa automática recente = pago_em >= hoje - JANELA_DIAS.
const JANELA_DIAS = 30

const CONTENT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
}

function tipoArquivo(path: string): { ext: string; contentType: string | null } {
  const ext = (path.split('.').pop() ?? '').toLowerCase()
  return { ext: ext || 'dat', contentType: CONTENT_TYPES[ext] ?? null }
}

// Bucket privado — a UI só vê o arquivo via signed URL de curta duração.
function adminStorage() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  ).storage.from('documentos')
}

interface Row {
  id: string
  cliente_id: string
  descricao: string
  valor_centavos: number
  vencimento: string
  pago_em: string | null
  pago_valor_centavos: number | null
  comprovante_url: string | null
  comprovante_dados: Record<string, unknown> | null
}

export async function GET(_req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ROLES)
  if (gate) return gate
  const { supabase, usuario } = auth

  const desde = new Date(Date.now() - JANELA_DIAS * 86400000).toISOString()

  const { data, error, count } = await supabase
    .from('parcelas')
    .select(
      'id, cliente_id, descricao, valor_centavos, vencimento, pago_em, pago_valor_centavos, comprovante_url, comprovante_dados',
      { count: 'exact' },
    )
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'paga')
    .eq('baixa_automatica', true)
    .gte('pago_em', desde)
    .order('pago_em', { ascending: false })
  if (error) return jsonError(error.message, 500)

  const linhas = (data ?? []) as unknown as Row[]

  // Nome do cliente em lote (uma query só).
  const clienteIds = [...new Set(linhas.map((r) => r.cliente_id).filter(Boolean))]
  const nomes = new Map<string, string | null>()
  if (clienteIds.length > 0) {
    const { data: clientes } = await supabase
      .from('clientes')
      .select('id, nome')
      .eq('tenant_id', usuario.tenant_id)
      .in('id', clienteIds)
    for (const c of clientes ?? []) nomes.set(c.id, c.nome)
  }

  const store = adminStorage()
  const baixas = await Promise.all(
    linhas.map(async (r) => {
      let imagemUrl: string | null = null
      let contentType: string | null = null
      if (r.comprovante_url) {
        const t = tipoArquivo(r.comprovante_url)
        contentType = t.contentType
        const { data: signed, error: sErr } = await store.createSignedUrl(r.comprovante_url, 600)
        if (sErr) logger.error('financeiro.baixas_automaticas.signed_url', { id: r.id, tenantId: usuario.tenant_id })
        imagemUrl = signed?.signedUrl ?? null
      }
      const dados = (r.comprovante_dados ?? null) as Record<string, unknown> | null
      return {
        id: r.id,
        cliente_id: r.cliente_id,
        cliente_nome: nomes.get(r.cliente_id) ?? null,
        descricao: r.descricao,
        valor_centavos: r.valor_centavos,
        pago_valor_centavos: r.pago_valor_centavos,
        vencimento: r.vencimento,
        pago_em: r.pago_em,
        dados: dados && typeof dados.valorCentavos === 'number' ? dados : null,
        imagemUrl,
        content_type: contentType,
      }
    }),
  )

  return NextResponse.json({ baixas, total: count ?? baixas.length })
}
