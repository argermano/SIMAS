import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logger } from '@/lib/logger'
import { relayFetch } from '@/lib/conversas/relay'
import { menorId } from '@/lib/conversas/paginacao'
import {
  MOTIVO_NAO_EDITAVEL,
  acharWaidNoAcervo,
  podeEditar,
  waIdDoSourceId,
  type LinhaAcervoMatch,
} from '@/lib/conversas/edicao'
import type { Mensagem, RespostaMensagens } from '@/lib/conversas/tipos'

// PATCH /api/conversas/[id]/mensagens/[mensagemId] — EDITAR uma mensagem já
// enviada, no padrão WhatsApp (janela de ~15 min; usamos 14, ver edicao.ts).
//
// Caminho: SIMAS → ai-attendant (POST /editar, X-Notify-Token) → Evolution
// (PUT /chat/updateMessage). O Chatwoot NÃO tem API de editar conteúdo — o
// `update` de mensagens só mexe em status — então o texto original PERMANECE lá
// e a edição aparece como um acompanhamento "Editada: <novo texto>".
//
// NOTA DE DESENHO: esse acompanhamento é postado pelo PRÓPRIO Evolution (a
// integração Chatwoot dele reage aos eventos messages.edit / send.message.update).
// O SIMAS não posta nada no Chatwoot — nem nota, nem aviso. A tela /conversas
// espelha o Chatwoot e mostra o acompanhamento sozinha; qualquer coisa escrita
// daqui viraria mensagem DUPLICADA na conversa do cliente.
//
// A janela é curta e o caminho tem três saltos: maxDuration folgado para o
// relay (8s) + VPS (10s) caberem sem a função ser cortada no meio.
export const maxDuration = 30

const schema = z.object({ texto: z.string().min(1).max(4096) })

/** Recorte do acervo que resolve o alvo da edição. */
interface AlvoEdicao {
  /** key.id da Evolution (WAID). */
  waid: string
  instancia: string
  jid: string
}

/** Falhas tipadas do salto ao VPS — mesma doutrina de src/lib/processos/notificar.ts. */
type MotivoFalha = 'sem_config' | 'timeout' | 'http' | 'erro'

/**
 * URL do /editar no VPS DERIVADA do PROCESSOS_NOTIFY_URL: é o MESMO serviço
 * (ai-attendant), a MESMA autenticação (X-Notify-Token) e o mesmo host — criar
 * uma env nova só para trocar o último segmento do caminho seria mais um segredo
 * para manter em sincronia no cofre da Vercel (e um jeito novo de a produção
 * ficar meio configurada). Estrito de propósito: se o pathname não terminar em
 * /notify, não adivinhamos nada — devolvemos null e a rota responde 'sem_config'
 * em vez de POSTar um corpo de edição num endpoint que envia mensagem.
 */
function urlEditar(): string | null {
  const base = process.env.PROCESSOS_NOTIFY_URL
  if (!base) return null
  try {
    const u = new URL(base)
    if (!/\/notify\/?$/.test(u.pathname)) return null
    u.pathname = u.pathname.replace(/\/notify\/?$/, '/editar')
    return u.toString()
  } catch {
    return null
  }
}

/**
 * Manda a edição ao ai-attendant. SEM RETRY, por doutrina: o timeout de 10s é a
 * janela "talvez já editou" — a Evolution pode ter aplicado a alteração e só a
 * resposta HTTP ter demorado. Re-tentar às cegas não corrige nada e ainda mente
 * para quem está na tela; devolvemos o motivo e a UI conta a verdade.
 */
async function pedirEdicaoAoVps(corpo: {
  instance: string
  remoteJid: string
  waId: string
  texto: string
}): Promise<{ ok: true } | { ok: false; motivo: MotivoFalha; status?: number }> {
  const url = urlEditar()
  const token = process.env.PROCESSOS_NOTIFY_TOKEN
  if (!url || !token) {
    logger.error('conversas.editar.sem_config', { temUrl: !!url, temToken: !!token })
    return { ok: false, motivo: 'sem_config' }
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Notify-Token': token },
      body: JSON.stringify(corpo),
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (r.ok) return { ok: true }
    logger.error('conversas.editar.http', { status: r.status })
    return { ok: false, motivo: 'http', status: r.status }
  } catch (err) {
    clearTimeout(timer)
    logger.error('conversas.editar.excecao', {}, err as Error)
    const timeout = err instanceof Error && err.name === 'AbortError'
    return { ok: false, motivo: timeout ? 'timeout' : 'erro' }
  }
}

/** Cliente service_role: o acervo é RLS service-only (migration 082). */
function admin() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/** jid da conversa do acervo (a identidade do chat no WhatsApp). */
async function jidDaConversaAcervo(
  db: ReturnType<typeof admin>,
  tenantId: string,
  conversaId: string,
): Promise<string | null> {
  const { data } = await db
    .from('conversas_acervo')
    .select('jid')
    .eq('tenant_id', tenantId)
    .eq('id', conversaId)
    .maybeSingle()
  const jid = (data as { jid?: string } | null)?.jid
  return typeof jid === 'string' && jid ? jid : null
}

/**
 * ESCADA DO WAID — do mais confiável ao mais trabalhoso. O acervo próprio
 * (conversa_mensagens) é a fonte da verdade: é ele que guarda o key.id da
 * Evolution, e é dele que sai também a instância/jid do chat — ou seja, jamais
 * confiamos no cliente para dizer QUAL conversa do WhatsApp editar.
 *
 *  1) source_id da própria mensagem no Chatwoot ('WAID:<key.id>');
 *  2) a linha que a reconciliação postou (chatwoot_msg_id = id do Chatwoot);
 *  3) casamento por conteúdo + tempo nas mensagens de SAÍDA da conversa nas
 *     últimas 2 h — o escopo vem dos WAIDs das mensagens VIZINHAS da mesma
 *     página, que dizem a qual conversa do acervo esta thread corresponde.
 * Nada casou → null, e a rota responde 404 em vez de arriscar editar outra coisa.
 */
async function resolverAlvo(
  db: ReturnType<typeof admin>,
  tenantId: string,
  alvo: Mensagem,
  pagina: Mensagem[],
): Promise<AlvoEdicao | null> {
  // (1) WAID direto do source_id.
  const waidDireto = waIdDoSourceId(alvo.sourceId)
  if (waidDireto) {
    const { data } = await db
      .from('conversa_mensagens')
      .select('instancia, conversa_id')
      .eq('tenant_id', tenantId)
      .eq('mensagem_id', waidDireto)
      .limit(1)
      .maybeSingle()
    const linha = data as { instancia?: string; conversa_id?: string } | null
    if (linha?.instancia && linha.conversa_id) {
      const jid = await jidDaConversaAcervo(db, tenantId, linha.conversa_id)
      if (jid) return { waid: waidDireto, instancia: linha.instancia, jid }
    }
  }

  // (2) Linha que NÓS postamos no Chatwoot (reconciliação da Etapa 1).
  {
    const { data } = await db
      .from('conversa_mensagens')
      .select('mensagem_id, instancia, conversa_id')
      .eq('tenant_id', tenantId)
      .eq('chatwoot_msg_id', String(alvo.id))
      .limit(1)
      .maybeSingle()
    const linha = data as
      | { mensagem_id?: string; instancia?: string; conversa_id?: string }
      | null
    if (linha?.mensagem_id && linha.instancia && linha.conversa_id) {
      const jid = await jidDaConversaAcervo(db, tenantId, linha.conversa_id)
      if (jid) return { waid: linha.mensagem_id, instancia: linha.instancia, jid }
    }
  }

  // (3) Casamento por conteúdo + tempo. Primeiro descobrimos QUAL conversa do
  //     acervo é esta thread, pelos WAIDs das mensagens vizinhas da página.
  const waidsVizinhos = pagina
    .map((m) => waIdDoSourceId(m.sourceId))
    .filter((w): w is string => !!w)
    .slice(0, 50)
  if (waidsVizinhos.length === 0) return null

  const { data: vizinhas } = await db
    .from('conversa_mensagens')
    .select('conversa_id, instancia')
    .eq('tenant_id', tenantId)
    .in('mensagem_id', waidsVizinhos)
  const linhasVizinhas = (vizinhas ?? []) as { conversa_id: string; instancia: string }[]
  if (linhasVizinhas.length === 0) return null

  // A conversa MAIS FREQUENTE entre as vizinhas: uma linha órfã (id do WhatsApp
  // repetido em outra caixa) não pode arrastar a edição para o chat errado.
  const contagem = new Map<string, { n: number; instancia: string }>()
  for (const v of linhasVizinhas) {
    const atual = contagem.get(v.conversa_id)
    if (atual) atual.n += 1
    else contagem.set(v.conversa_id, { n: 1, instancia: v.instancia })
  }
  let escolhida: { conversaId: string; instancia: string; n: number } | null = null
  for (const [conversaId, { n, instancia }] of contagem) {
    if (!escolhida || n > escolhida.n) escolhida = { conversaId, instancia, n }
  }
  if (!escolhida) return null

  const desde = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
  const { data: candidatas } = await db
    .from('conversa_mensagens')
    .select('mensagem_id, texto, timestamp_msg, de_mim, tipo')
    .eq('tenant_id', tenantId)
    .eq('conversa_id', escolhida.conversaId)
    .eq('de_mim', true)
    .eq('tipo', 'texto')
    .gte('timestamp_msg', desde)
    .limit(200)

  const waid = acharWaidNoAcervo((candidatas ?? []) as LinhaAcervoMatch[], {
    conteudo: alvo.conteudo,
    criadaEmIso: new Date(alvo.timestamp * 1000).toISOString(),
  })
  if (!waid) return null

  const jid = await jidDaConversaAcervo(db, tenantId, escolhida.conversaId)
  if (!jid) return null
  return { waid, instancia: escolhida.instancia, jid }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mensagemId: string }> },
) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const texto = parsed.data.texto

  const { id, mensagemId } = await params
  // Guarda defensiva: os dois ids do Chatwoot são numéricos (evita path-injection).
  if (!/^\d+$/.test(id) || !/^\d+$/.test(mensagemId)) {
    return jsonError('Mensagem inválida', 400)
  }
  const alvoId = Number(mensagemId)

  // 1) A mensagem, pelo relay. Uma mensagem editável é RECENTE, então ela está na
  //    primeira página; a página anterior é só a rede de segurança para a thread
  //    que recebeu uma rajada logo depois do envio.
  const primeira = await relayFetch(`/conversations/${id}/messages`, { method: 'GET', email })
  if (primeira.status !== 200) {
    return NextResponse.json(primeira.data, { status: primeira.status })
  }
  let pagina = ((primeira.data as RespostaMensagens)?.mensagens ?? []) as Mensagem[]
  let alvo = pagina.find((m) => m.id === alvoId) ?? null

  if (!alvo) {
    const antes = menorId(pagina)
    if (antes !== null) {
      const anterior = await relayFetch(`/conversations/${id}/messages`, {
        method: 'GET',
        email,
        query: { before: String(antes) },
      })
      if (anterior.status === 200) {
        const maisAntigas = ((anterior.data as RespostaMensagens)?.mensagens ?? []) as Mensagem[]
        pagina = [...maisAntigas, ...pagina]
        alvo = maisAntigas.find((m) => m.id === alvoId) ?? null
      }
    }
  }
  if (!alvo) return jsonError('Mensagem não encontrada nesta conversa', 404)

  // 2) A regra é a MESMA da tela (lib compartilhada) — revalidada aqui porque o
  //    relógio anda entre o clique e o PATCH.
  if (!podeEditar(alvo, Date.now())) {
    return NextResponse.json({ ok: false, error: MOTIVO_NAO_EDITAVEL }, { status: 422 })
  }

  // 3) Onde essa mensagem vive no WhatsApp (id + instância + chat).
  const db = admin()
  const tenantId = auth.usuario.tenant_id
  const destino = await resolverAlvo(db, tenantId, alvo, pagina)
  if (!destino) {
    logger.error('conversas.editar.sem_waid', { conversaId: id, mensagemId: alvoId })
    return jsonError(
      'Não localizei essa mensagem no WhatsApp para editar. Se ela foi enviada por fora do SIMAS, edite pelo próprio celular.',
      404,
    )
  }

  // 4) O salto ao VPS.
  const envio = await pedirEdicaoAoVps({
    instance: destino.instancia,
    remoteJid: destino.jid,
    waId: destino.waid,
    texto,
  })

  if (!envio.ok) {
    if (envio.motivo === 'sem_config') {
      return NextResponse.json(
        { ok: false, motivo: 'sem_config', error: 'Canal de WhatsApp não configurado no servidor — avise o suporte.' },
        { status: 500 },
      )
    }
    if (envio.motivo === 'timeout') {
      return NextResponse.json(
        {
          ok: false,
          motivo: 'timeout',
          error:
            'Não deu para confirmar a edição — confira no WhatsApp antes de tentar de novo. A alteração pode ter sido aplicada.',
        },
        { status: 504 },
      )
    }
    return NextResponse.json(
      { ok: false, motivo: 'http', error: 'O WhatsApp recusou a edição. A janela de 15 minutos pode ter fechado.' },
      { status: 502 },
    )
  }

  // 5) Acervo em dia — BEST-EFFORT. O WhatsApp já foi editado; falhar a resposta
  //    agora só faria o atendente reenviar uma edição que já aconteceu. Falha
  //    vira log e nada mais (a varredura do medidor enxerga a divergência).
  //    LGPD: log só com ids — o texto NUNCA entra em log.
  try {
    const { error } = await db
      .from('conversa_mensagens')
      .update({ texto, rec_detalhe: 'editada via SIMAS' })
      .eq('tenant_id', tenantId)
      .eq('instancia', destino.instancia)
      .eq('mensagem_id', destino.waid)
    if (error) logger.error('conversas.editar.acervo', { conversaId: id, mensagemId: alvoId })
  } catch {
    logger.error('conversas.editar.acervo_excecao', { conversaId: id, mensagemId: alvoId })
  }

  logger.info('conversas.editar.ok', { conversaId: id, mensagemId: alvoId, chars: texto.length })
  return NextResponse.json({ ok: true })
}
