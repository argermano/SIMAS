import { NextResponse } from 'next/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { autorizadoIntegracao } from '@/lib/funil/auth-integracao'
import { chaveTelefone, mesmoTelefone } from '@/lib/funil/telefone'
import { sincronizarProcessosDoClienteSeVelho } from '@/lib/processos/sync'
import { logger } from '@/lib/logger'

export const maxDuration = 20

// GET /api/integracao/processos/by-phone/[telefone] — chamada pelo ai-attendant
// (Lote 3). Casa o telefone com um CLIENTE do escritório e devolve o andamento
// FACTUAL (resumo + nome + data) dos processos dele. Nunca devolve dados de outro
// cliente; 200 { ok:false } quando não há correspondência. Ver PLANO §7.
export async function GET(req: Request, { params }: { params: Promise<{ telefone: string }> }) {
  if (!autorizadoIntegracao(req)) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
  }

  const tenantId = process.env.FUNIL_TENANT_ID
  if (!tenantId) {
    logger.error('processos.by_phone.sem_tenant', {})
    return NextResponse.json({ ok: false })
  }

  const { telefone } = await params
  let alvo: string
  try {
    alvo = decodeURIComponent(telefone)
  } catch {
    return NextResponse.json({ ok: false }) // URI malformada: contrato é sempre 200
  }

  const admin = createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  // Perf: antes carregava TODOS os clientes do tenant e casava em JS (O(clientes)
  // por mensagem de WhatsApp). Agora busca por igualdade indexada em
  // telefone_chave (migration 070) — a coluna gerada guarda a MESMA chave de
  // chaveTelefone(), então a comparação no banco é idêntica à de mesmoTelefone():
  // DDD + 8 finais, tolerante a DDI 55, 9º dígito e cadastros fora do padrão
  // (dois números no campo etc., cuja chave recorta os finais como o JS fazia).
  // Sem variantes = telefone sem DDD+número confiável, que nunca casa linha real.
  const variantes = variantesChave(alvo)
  if (variantes.length === 0) return NextResponse.json({ ok: false })

  // Clientes reais do escritório (exclui pré-cadastros do funil e apagados).
  // Ordem determinística: se dois clientes compartilham a linha, o match é estável.
  // .in em telefone_chave já descarta telefone nulo (chave = '').
  const { data: clientes } = await admin
    .from('clientes')
    .select('id, nome, telefone')
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .neq('status_cadastro', 'pre_cadastro')
    .in('telefone_chave', variantes)
    .order('created_at', { ascending: true })

  // mesmoTelefone() segue como autoridade final do match (belt-and-suspenders):
  // toda linha retornada pelo .in já casa por construção, então isto preserva o
  // desempate por created_at sem mudar quais clientes são encontrados.
  const cliente = (clientes ?? []).find((c) => mesmoTelefone(c.telefone, alvo))
  if (!cliente) return NextResponse.json({ ok: false })

  // Arquitetura on-demand: a consulta do próprio cliente motiva uma atualização
  // rápida no DataJud (só dos processos "velhos", budget curto). Se o DataJud não
  // responder a tempo, segue com o último dado armazenado (best-effort).
  await sincronizarProcessosDoClienteSeVelho(admin, cliente.id).catch(() => {})

  const { data: processos } = await admin
    .from('processos')
    .select('id, numero_cnj, apelido, classe, orgao_julgador, situacao')
    .eq('tenant_id', tenantId)
    .eq('cliente_id', cliente.id)
    .order('created_at', { ascending: false })

  if (!processos || processos.length === 0) {
    return NextResponse.json({ ok: true, temProcessos: false, cliente: { primeiroNome: primeiroNome(cliente.nome) } })
  }

  // Perf: uma query pelos movimentos de TODOS os processos do cliente (antes era
  // N+1 — uma query por processo). Vem ordenada por data_hora desc (nulls por
  // último), igual à query original; o agrupamento abaixo mantém os 5 mais
  // recentes por processo preservando essa ordem.
  const processoIds = processos.map((p) => p.id)
  const { data: movsAll } = await admin
    .from('processo_movimentos')
    .select('processo_id, nome, resumo_ia, data_hora')
    .in('processo_id', processoIds)
    .order('data_hora', { ascending: false, nullsFirst: false })

  const movsPorProcesso = new Map<string, { nome: string | null; resumo_ia: string | null; data_hora: string | null }[]>()
  for (const m of movsAll ?? []) {
    let arr = movsPorProcesso.get(m.processo_id)
    if (!arr) {
      arr = []
      movsPorProcesso.set(m.processo_id, arr)
    }
    if (arr.length < 5) arr.push(m) // já ordenado desc: os 5 primeiros são os mais recentes
  }

  const saida = processos.map((p) => ({
    apelido: p.apelido,
    numero: p.numero_cnj,
    classe: p.classe,
    orgao: p.orgao_julgador,
    situacao: p.situacao,
    ultimos: (movsPorProcesso.get(p.id) ?? []).map((m) => ({
      data: m.data_hora ? String(m.data_hora).substring(0, 10) : null,
      resumo: m.resumo_ia,
      nome: m.nome,
    })),
  }))

  return NextResponse.json({
    ok: true,
    temProcessos: true,
    cliente: { primeiroNome: primeiroNome(cliente.nome) },
    processos: saida,
  })
}

// CHAVES que mesmoTelefone(cliente, alvo) aceitaria, para casar por igualdade em
// clientes.telefone_chave (migration 070). mesmoTelefone compara as chaves por
// igualdade OU por (mesmo DDD + mesmos 8 finais) — o que dá exatamente as formas
// DDD+8 (sem 9º dígito) e DDD+X+8 com X∈0–9 (com 9º dígito em qualquer valor,
// cobrindo 61996141851 × 6196141851 nos dois sentidos). Sem formas com DDI: a
// chave já o remove dos dois lados. Chave do alvo < 10 dígitos = sem DDD+número
// confiável → sem variantes (nunca casou linha real antes, e segue não casando).
function variantesChave(alvo: string): string[] {
  const chave = chaveTelefone(alvo)
  if (chave.length < 10) return []
  const ddd = chave.slice(0, 2)
  const num8 = chave.slice(-8)
  const out = new Set<string>([`${ddd}${num8}`])
  for (let x = 0; x <= 9; x++) out.add(`${ddd}${x}${num8}`)
  return [...out]
}

function primeiroNome(nome: string | null): string {
  const p = (nome ?? '').trim().split(/\s+/)[0]
  return p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : ''
}
