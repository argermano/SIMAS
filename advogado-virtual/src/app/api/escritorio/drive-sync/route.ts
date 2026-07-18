import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { driveDisponivel } from '@/lib/drive/auth'
import { processarFilaDrive, verificarRaiz } from '@/lib/drive/espelho'

// Espelho do dossiê no Google Drive (066): estado + drenagem manual da fila.
// Só admin. A drenagem AGORA é o botão "Sincronizar agora" em Configurações; o
// grosso do trabalho roda na folga do cron diário funil-consultas. drive_sync_fila
// é service-only (RLS sem policy) → o service_role bypassa a RLS aqui.
export const maxDuration = 60

function adminClient() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

// GET — estado do espelho para o card de Configurações (admin). Não expõe ids.
//  • configurado: as 2 envs presentes (senão o espelho fica INERTE);
//  • raizOk: a pasta raiz existe e a service account a acessa (GET no id);
//  • pendentes: clientes na fila deste tenant aguardando espelhamento.
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin'])
  if (gate) return gate

  const admin = adminClient()
  const { count } = await admin
    .from('drive_sync_fila')
    .select('cliente_id', { count: 'exact', head: true })
    .eq('tenant_id', auth.usuario.tenant_id)

  const configurado = driveDisponivel()
  // Só bate no Drive se estiver configurado (verificarRaiz já é fail-safe).
  const raizOk = configurado ? await verificarRaiz() : false

  return NextResponse.json({ configurado, raizOk, pendentes: count ?? 0 })
}

// POST — drena a fila AGORA (botão "Sincronizar agora"). Teto ~55s sob o
// maxDuration=60. Devolve {clientes processados, arquivos enviados, erros}; o que
// não couber no tempo permanece na fila durável para o próximo ciclo.
export async function POST() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin'])
  if (gate) return gate

  if (!driveDisponivel()) {
    return jsonError('O espelho no Google Drive não está configurado neste ambiente.', 400)
  }

  const r = await processarFilaDrive(adminClient(), { deadline: Date.now() + 55_000 })
  return NextResponse.json({ clientes: r.clientes, arquivos: r.arquivos, erros: r.erros })
}
