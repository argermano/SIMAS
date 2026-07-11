import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { normalizarChavePix } from '@/lib/financeiro/pix'

// Configuração financeira do escritório — tenants.config.financeiro
// { pix_chave, pix_nome, pix_cidade } (Pix copia-e-cola das cobranças).
// Padrão do config-processos: GET para qualquer papel autenticado (a equipe
// toda gera o Pix), PATCH admin/advogado com merge preservando o restante
// do config. Sem migration — config JSON.

function adminClient() {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

interface ConfigFinanceiro {
  pix_chave?: string
  pix_nome?: string
  pix_cidade?: string
}

// GET — devolve a config do Pix do escritório.
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data: tenant } = await supabase
    .from('tenants')
    .select('config')
    .eq('id', usuario.tenant_id)
    .single()

  const fin = ((tenant?.config as { financeiro?: ConfigFinanceiro } | null)?.financeiro ?? {})
  const pix_chave = fin.pix_chave ?? null
  const pix_nome = fin.pix_nome ?? null
  const pix_cidade = fin.pix_cidade ?? null

  return NextResponse.json({
    pix_chave,
    pix_nome,
    pix_cidade,
    configurado: !!(pix_chave && pix_nome && pix_cidade),
  })
}

const schema = z.object({
  pix_chave: z.string().trim().max(77).optional(),   // chave Pix (e-mail/telefone/CPF/CNPJ/aleatória)
  pix_nome: z.string().trim().max(50).optional(),    // truncado a 25 sem acento no BR Code
  pix_cidade: z.string().trim().max(30).optional(),  // truncada a 15 sem acento no BR Code
})

// PATCH — salva a config do Pix (admin/advogado). Merge preservando as demais
// chaves de tenants.config e de config.financeiro. String vazia limpa o campo.
export async function PATCH(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { usuario } = auth
  const gate = requireRole(usuario, ['admin', 'advogado'])
  if (gate) return gate

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const dados = parsed.data

  // Normaliza a chave Pix para o formato que os bancos resolvem (CPF/CNPJ só
  // dígitos, telefone +55..., e-mail lowercase, EVP). Chave irreconhecível ou
  // com caractere fora do ASCII geraria um BR Code que o banco rejeita.
  if (dados.pix_chave !== undefined && dados.pix_chave !== '') {
    const normalizada = normalizarChavePix(dados.pix_chave)
    if (!normalizada) {
      return jsonError(
        'Chave Pix inválida — use CPF/CNPJ, e-mail, telefone (+55DDDNÚMERO) ou chave aleatória',
        400,
      )
    }
    dados.pix_chave = normalizada
  }

  const admin = adminClient()
  const { data: tenant } = await admin.from('tenants').select('config').eq('id', usuario.tenant_id).single()
  const config: Record<string, unknown> = { ...(tenant?.config ?? {}) }
  const financeiro: ConfigFinanceiro = { ...((config.financeiro as ConfigFinanceiro) ?? {}) }

  const camposAlterados: string[] = []
  for (const campo of ['pix_chave', 'pix_nome', 'pix_cidade'] as const) {
    const valor = dados[campo]
    if (valor === undefined) continue
    if (valor === '') delete financeiro[campo]
    else financeiro[campo] = valor
    camposAlterados.push(campo)
  }
  config.financeiro = financeiro

  const { error } = await admin.from('tenants').update({ config }).eq('id', usuario.tenant_id)
  if (error) return jsonError(error.message, 500)

  // LGPD: a chave Pix pode ser CPF — não vai para a auditoria, só os campos tocados.
  await logAudit({
    tenantId: usuario.tenant_id,
    userId: usuario.id,
    action: 'financeiro.config',
    resourceType: 'tenant',
    resourceId: usuario.tenant_id,
    metadata: { campos: camposAlterados },
  })

  return NextResponse.json({
    ok: true,
    pix_chave: financeiro.pix_chave ?? null,
    pix_nome: financeiro.pix_nome ?? null,
    pix_cidade: financeiro.pix_cidade ?? null,
    configurado: !!(financeiro.pix_chave && financeiro.pix_nome && financeiro.pix_cidade),
  })
}
