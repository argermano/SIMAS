import { NextRequest, NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { logger } from '@/lib/logger'
import { marcarPossiveisDuplicados } from '@/lib/financeiro/duplicados'

// GET /api/financeiro/comprovantes — INBOX de comprovantes recebidos no WhatsApp
// que a IA leu como comprovante mas que NÃO viraram staging (sem cobrança
// correspondente). Fila do atendente para conferir e ATRIBUIR a um contrato/
// cliente. Só os 'pendente' do tenant, mais recentes primeiro, cada um com duas
// signed URLs curtas (inline + download) — padrão da rota .../pagamento.
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

interface InboxRow {
  id: string
  criado_em: string
  telefone: string
  conversa_id: string | null
  cliente_id: string | null
  dados: Record<string, unknown> | null
  content_type: string | null
  arquivo_url: string
}

export async function GET(_req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ROLES)
  if (gate) return gate
  const { supabase, usuario } = auth

  const { data, error, count } = await supabase
    .from('comprovantes_recebidos')
    .select('id, criado_em, telefone, conversa_id, cliente_id, dados, content_type, arquivo_url', {
      count: 'exact',
    })
    .eq('tenant_id', usuario.tenant_id)
    .eq('status', 'pendente')
    .order('criado_em', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const linhas = (data ?? []) as unknown as InboxRow[]

  // Nome do cliente em lote (palpite do inbox; pode ser null no caso d).
  const clienteIds = [...new Set(linhas.map((r) => r.cliente_id).filter((v): v is string => !!v))]
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
  const comprovantes = await Promise.all(
    linhas.map(async (r) => {
      const { ext, contentType } = tipoArquivo(r.arquivo_url)
      const dataArq = (r.criado_em ?? '').slice(0, 10) || 'comprovante'
      const nomeDownload = `comprovante-${dataArq}.${ext}`
      const [inline, download] = await Promise.all([
        store.createSignedUrl(r.arquivo_url, 600),
        store.createSignedUrl(r.arquivo_url, 600, { download: nomeDownload }),
      ])
      if (inline.error || download.error) {
        logger.error('financeiro.comprovantes.signed_url', { id: r.id, tenantId: usuario.tenant_id })
      }
      // Shape achatado do contrato ComprovanteRecebido que a UI consome
      // (cliente_id/cliente_nome/content_type/status) — colunas em snake_case,
      // não um objeto `cliente` aninhado.
      return {
        id: r.id,
        cliente_id: r.cliente_id,
        cliente_nome: r.cliente_id ? (nomes.get(r.cliente_id) ?? null) : null,
        telefone: r.telefone,
        conversa_id: r.conversa_id,
        dados: r.dados,
        content_type: r.content_type ?? contentType,
        imagemUrl: inline.data?.signedUrl ?? null,
        downloadUrl: download.data?.signedUrl ?? null,
        criado_em: r.criado_em,
        status: 'pendente', // a query filtra status='pendente'
      }
    }),
  )

  // Marca POSSÍVEIS DUPLICADOS (retroativo, para a fila atual): o mesmo
  // comprovante reenviado em mensagens diferentes gera linhas distintas (a
  // UNIQUE tenant+mensagem_id não pega). Lógica pura em lib (testável sem rede).
  const comDup = marcarPossiveisDuplicados(comprovantes)

  return NextResponse.json({ comprovantes: comDup, total: count ?? comDup.length })
}
