import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { jsonError } from '@/lib/api'
import { autorizadoIntegracao } from '@/lib/funil/auth-integracao'
import { apenasDigitos, normalizarE164 } from '@/lib/funil/telefone'
import { logger } from '@/lib/logger'

// GET /api/integracao/equipe-celulares — o bot (ai-attendant) busca os WhatsApps
// da EQUIPE para IGNORÁ-LOS: quando um número desses escreve, é um colega (não um
// cliente) e a IA não deve responder. Auth: x-simas-token (autorizadoIntegracao);
// escopo FUNIL_TENANT_ID — MESMO padrão de /api/integracao/presenca.
//
// Devolve { celulares: ['5561...', ...] }: SÓ DÍGITOS (com DDI 55), dos membros
// ATIVOS que têm celular cadastrado. LGPD: loga apenas a CONTAGEM, nunca números.
export async function GET(req: Request) {
  if (!autorizadoIntegracao(req)) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const tenantId = process.env.FUNIL_TENANT_ID
  if (!tenantId) return jsonError('FUNIL_TENANT_ID não configurado', 500)

  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await admin
    .from('users')
    .select('celular')
    .eq('tenant_id', tenantId)
    .eq('status', 'ativo')
    .not('celular', 'is', null)
  if (error) return jsonError('Erro ao consultar celulares da equipe', 500)

  // Normaliza para dígitos com DDI 55 (E.164 sem o '+') e deduplica. Descarta
  // números curtos demais (< 10 dígitos = incompletos) por segurança.
  const celulares = [
    ...new Set(
      (data ?? [])
        .map((u) => apenasDigitos(normalizarE164((u.celular as string) ?? '')))
        .filter((d) => d.length >= 12), // 55 + DDD(2) + número(8/9)
    ),
  ]

  logger.info('integracao.equipe_celulares', { total: celulares.length })

  return NextResponse.json({ celulares })
}
