import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { jsonError, validateBody } from '@/lib/api'
import { autorizadoIntegracao } from '@/lib/funil/auth-integracao'
import { logger } from '@/lib/logger'
import { loteEventosSchema } from '@/lib/conversas-acervo/contrato'
import { ingerirEventos } from '@/lib/conversas-acervo/ingestao'

// POST /api/integracao/conversas/eventos — o encaminhador do VPS (ai-attendant)
// entrega aqui TODO evento do WhatsApp visto pelo webhook da Evolution (lote de
// até 50). Etapa 0 do plano Conversas Próprias: nada é desligado — este acervo
// roda em PARALELO à ponte Evolution↔Chatwoot.
//
// Auth: x-simas-token (autorizadoIntegracao) + escopo FUNIL_TENANT_ID — mesmo
// padrão de /api/integracao/presenca e /api/integracao/equipe-celulares.
// O middleware já isenta TODO o prefixo /api/integracao de redirect para /login
// (rotasApiAutonomas em src/lib/supabase/middleware.ts) — nada a acrescentar lá.
//
// Contrato de retentativa: 2xx = lote consumido; 5xx/timeout = o VPS re-envia o
// lote INTEIRO. O dedupe (UNIQUE tenant+instancia+mensagem_id) torna isso seguro.
// LGPD: log só com contagens — o conteúdo é o produto e fica no banco, protegido
// por RLS service-only.
export async function POST(req: Request) {
  if (!autorizadoIntegracao(req)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const tenantId = process.env.FUNIL_TENANT_ID
  if (!tenantId) return jsonError('FUNIL_TENANT_ID não configurado', 500)

  const parsed = await validateBody(req, loteEventosSchema)
  if (!parsed.ok) return parsed.response
  const { eventos } = parsed.data

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  try {
    const { aceitos, duplicados } = await ingerirEventos(admin, tenantId, eventos)
    logger.info('conversas_acervo.eventos', {
      recebidos: eventos.length,
      aceitos,
      duplicados,
    })
    return NextResponse.json({ ok: true, aceitos, duplicados })
  } catch (erro) {
    // 500 de propósito: o encaminhador re-envia o lote inteiro (idempotente).
    logger.error('conversas_acervo.eventos_falhou', { recebidos: eventos.length }, erro)
    return jsonError('Falha ao ingerir o lote', 500)
  }
}
