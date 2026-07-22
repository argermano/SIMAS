import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { logger } from '@/lib/logger'

// GET /api/financeiro/parcelas/[id]/pagamento — detalhes da baixa de uma parcela
// JÁ PAGA (a UX "Ver pagamento"): valor/data/meio/quem confirmou + os dados que a
// IA extraiu do comprovante + o próprio comprovante (duas signed URLs curtas:
// uma inline p/ <img>/nova aba, outra que força download). Só leitura.
// TODA a equipe (admin/advogado/colaborador) pode ver — igual às rotas irmãs.

const ROLES = ['admin', 'advogado', 'colaborador']

// Extensão do path → contentType (bucket privado; a UI decide <img> vs PDF) e a
// extensão para o nome do download. Desconhecido → contentType null.
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

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ROLES)
  if (gate) return gate
  const { supabase, usuario } = auth

  const { data: parcela } = await supabase
    .from('parcelas')
    .select('id, status, descricao, valor_centavos, vencimento, pago_em, pago_valor_centavos, meio, comprovante_url, comprovante_dados, baixa_por, baixa_obs, baixa_automatica')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()
  if (!parcela) return jsonError('Parcela não encontrada', 404)
  if (parcela.status !== 'paga') {
    return jsonError('Esta parcela não está paga', 409)
  }

  // Nome de quem confirmou a baixa (mesmo tenant — RLS "users: ver do tenant").
  let baixaPorNome: string | null = null
  if (parcela.baixa_por) {
    const { data: u } = await supabase
      .from('users')
      .select('nome')
      .eq('id', parcela.baixa_por)
      .eq('tenant_id', usuario.tenant_id)
      .maybeSingle()
    baixaPorNome = u?.nome ?? null
  }

  // Dados extraídos pela IA. Pode ser null OU um tombstone só com { mensagemId }
  // (dedup do webhook): sem valorCentavos não há dados de comprovante úteis.
  const rawDados = (parcela.comprovante_dados ?? null) as Record<string, unknown> | null
  const dados =
    rawDados && typeof rawDados.valorCentavos === 'number' ? rawDados : null

  // Comprovante: duas signed URLs de 10 min — inline (img/nova aba) e download
  // (Content-Disposition attachment via opção { download } do supabase-js v2).
  let comprovante: { url: string | null; downloadUrl: string | null; contentType: string | null } | null =
    null
  if (parcela.comprovante_url) {
    const store = adminStorage()
    const { ext, contentType } = tipoArquivo(parcela.comprovante_url)
    const dataArq = (parcela.pago_em ?? '').slice(0, 10) || 'comprovante'
    const nomeDownload = `comprovante-${dataArq}.${ext}`
    const [inline, download] = await Promise.all([
      store.createSignedUrl(parcela.comprovante_url, 600),
      store.createSignedUrl(parcela.comprovante_url, 600, { download: nomeDownload }),
    ])
    if (inline.error || download.error) {
      logger.error('financeiro.pagamento.signed_url', { parcelaId: id, tenantId: usuario.tenant_id })
    }
    comprovante = {
      url: inline.data?.signedUrl ?? null,
      downloadUrl: download.data?.signedUrl ?? null,
      contentType,
    }
  }

  return NextResponse.json({
    parcela: {
      descricao: parcela.descricao,
      valorCentavos: parcela.valor_centavos,
      vencimento: parcela.vencimento,
    },
    pagamento: {
      pagoEm: parcela.pago_em,
      valorPagoCentavos: parcela.pago_valor_centavos,
      meio: parcela.meio,
      baixaPorNome,
      obs: parcela.baixa_obs,
      // Baixa feita pelo SISTEMA (migration 077): a UI destaca e oferece DESFAZER.
      baixaAutomatica: parcela.baixa_automatica === true,
    },
    dados,
    comprovante,
  })
}
