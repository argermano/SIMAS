// server-only: DESPACHANTE de notificações a um membro da equipe. Dado um tipo
// do catálogo, carrega o destinatário, aplica as preferências dele e entrega por
// e-mail e/ou WhatsApp — cada canal em try/catch próprio. SEMPRE best-effort:
// nenhuma falha de canal derruba a operação que originou o aviso.
//
// E-mail: template da casa (src/lib/email.ts) com botão para a url.
// WhatsApp: aviso AUTOMÁTICO (sem autor → não pausa a IA) pelo mesmo canal do bot
// (src/lib/processos/notificar.ts); a instância de saída segue a UNIDADE do
// destinatário (é o WhatsApp dele), igual ao aviso diário de tarefas.
// LGPD: loga só ids/flags — nunca e-mail, número ou conteúdo.

import { createClient as createAdminClient, type SupabaseClient } from '@supabase/supabase-js'
import { logger } from '@/lib/logger'
import { enviarEmail, emailTemplate, escaparHtml } from '@/lib/email'
import { enviarAvisoWhatsApp } from '@/lib/processos/notificar'
import { instanciaDaUnidade } from '@/lib/conversas/instancia'
import { resolverPreferencias, type TipoNotificacao } from './catalogo'

/** Client service-role para ler o destinatário (email/celular/preferências) bypassa RLS. */
export function notificacoesAdmin(): SupabaseClient {
  return createAdminClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
}

export interface NotificarUsuarioInput {
  userId: string
  tipo: TipoNotificacao
  /** Assunto do e-mail + primeira linha do WhatsApp + título do template. */
  titulo: string
  /** Corpo do e-mail (texto simples; escapado antes de ir ao HTML). */
  corpo: string
  /** Destino do botão do e-mail e do link no WhatsApp. */
  url: string
}

export interface ResultadoNotificacao {
  email: boolean
  whatsapp: boolean
}

interface DestinatarioRow {
  id: string
  email: string | null
  celular: string | null
  unidade: string | null
  notificacoes: unknown
}

/**
 * Notifica um usuário conforme as preferências dele para `tipo`. Retorna quais
 * canais efetivamente saíram ({email, whatsapp}). Nunca lança.
 */
export async function notificarUsuario(
  admin: SupabaseClient,
  input: NotificarUsuarioInput,
): Promise<ResultadoNotificacao> {
  const resultado: ResultadoNotificacao = { email: false, whatsapp: false }

  const { data, error } = await admin
    .from('users')
    .select('id, email, celular, unidade, notificacoes')
    .eq('id', input.userId)
    .maybeSingle()

  if (error) {
    logger.error('notificacoes.destinatario_falha', { tipo: input.tipo }, error)
    return resultado
  }
  const user = data as DestinatarioRow | null
  if (!user) {
    logger.warn('notificacoes.destinatario_inexistente', { tipo: input.tipo })
    return resultado
  }

  const prefs = resolverPreferencias(user.notificacoes, input.tipo)

  // ── E-mail ────────────────────────────────────────────────────────────────
  if (prefs.email && user.email) {
    try {
      resultado.email = await enviarEmail({
        para: user.email,
        assunto: input.titulo,
        html: emailTemplate({
          titulo: input.titulo,
          conteudo: `<p style="white-space:pre-wrap;">${escaparHtml(input.corpo)}</p>`,
          botao: { texto: 'Abrir no SIMAS', url: input.url },
        }),
      })
    } catch (err) {
      logger.error('notificacoes.email_excecao', { userId: user.id, tipo: input.tipo }, err)
    }
  }

  // ── WhatsApp ──────────────────────────────────────────────────────────────
  if (prefs.whatsapp && user.celular) {
    try {
      const texto = `${input.titulo}\n${input.url}`
      const res = await enviarAvisoWhatsApp(user.celular, texto, instanciaDaUnidade(user.unidade))
      resultado.whatsapp = res.ok
    } catch (err) {
      logger.error('notificacoes.whatsapp_excecao', { userId: user.id, tipo: input.tipo }, err)
    }
  }

  logger.info('notificacoes.enviada', {
    userId: user.id,
    tipo: input.tipo,
    email: resultado.email,
    whatsapp: resultado.whatsapp,
  })
  return resultado
}
