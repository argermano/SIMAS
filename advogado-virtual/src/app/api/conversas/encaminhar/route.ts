import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { logAudit } from '@/lib/audit'
import { relayFetchBinario } from '@/lib/conversas/relay'
import { LIMITE_CAPTION_CHARS } from '@/lib/conversas/anexos'
import {
  dddDoDestino,
  falhaEnvioNumero,
  nomeParaEncaminhar,
  normalizarTelefoneDestino,
  resolverTipoEncaminhado,
  validarTamanhoParaNumero,
} from '@/lib/conversas/encaminhar'
import { instanciaDaUnidade } from '@/lib/conversas/instancia'
import { enviarMediaWhatsApp } from '@/lib/processos/notificar'

// maxDuration: baixar do relay + repassar um vídeo de até 40 MB acontece na MESMA
// invocação — o default de 10s da Vercel cortava o envio no meio.
export const maxDuration = 60

// POST /api/conversas/encaminhar — variante de DESTINO LIVRE do encaminhar: manda
// o anexo recebido para QUALQUER número de WhatsApp, com ou sem conversa aberta no
// Chatwoot (caso real do dono: vídeo chegou no grupo "Escritório pai" e precisava
// ir para um contato que não tinha conversa). Os bytes vêm do relay (mesma origem
// e mesma proteção SSRF do encaminhar por conversa); a ENTREGA vai pelo canal do
// bot (ai-attendant → Evolution), igual ao "Mensagem ao cliente".
// Destino que JÁ tem conversa: POST /api/conversas/[id]/encaminhar (mantém a
// thread no Chatwoot com o token pessoal do agente).
const schema = z.object({
  anexoUrl: z.string().url().max(2000),
  /** Celular/fixo BR com DDD (com ou sem máscara/DDI) — validado abaixo. */
  telefone: z.string().min(8).max(40),
  contentType: z.string().max(200).optional(),
  filename: z.string().max(300).optional(),
  caption: z.string().max(LIMITE_CAPTION_CHARS).optional(),
  /** Conversa de ORIGEM (auditoria: de onde saiu o anexo). */
  origemConversaId: z.number().int().positive().optional(),
  /** Cliente escolhido na busca, quando o destino veio do cadastro (auditoria). */
  clienteId: z.string().uuid().optional(),
})

export async function POST(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const gate = requireRole(auth.usuario, ['admin', 'advogado', 'colaborador'])
  if (gate) return gate

  const email = auth.user.email
  if (!email) return jsonError('E-mail do usuário ausente na sessão', 400)

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response
  const { anexoUrl, contentType: ctHint, filename, caption, origemConversaId, clienteId } = parsed.data

  const telefone = normalizarTelefoneDestino(parsed.data.telefone)
  if (!telefone) return jsonError('Número inválido — informe DDD + número (ex.: (47) 99118-6787)', 400)

  // Bytes de ORIGEM pelo relay (a proteção SSRF da URL é do relay).
  const origem = await relayFetchBinario('/attachments', {
    method: 'GET',
    email,
    query: { url: anexoUrl },
  })
  if (origem.status !== 200 || !origem.buffer) {
    return jsonError('Não foi possível baixar o anexo de origem', origem.status)
  }
  // Teto PRÓPRIO deste caminho (16 MB, mais apertado que os 45 MB do buffer
  // server-side): daqui o arquivo sai em base64 dentro de um JSON para o VPS.
  // Recusar aqui é mais honesto que gastar 30 s e devolver "tente novamente".
  const tamanho = validarTamanhoParaNumero(origem.buffer.length)
  if (!tamanho.ok) return jsonError(tamanho.erro, tamanho.status)

  const nome = nomeParaEncaminhar(filename, anexoUrl)
  const tipo = resolverTipoEncaminhado({ contentTypeRelay: origem.contentType, hint: ctHint, nome })
  if (!tipo.ok) return jsonError(tipo.erro, tipo.status)

  // Número de saída: default pela unidade do usuário logado (mesma regra do modal
  // "Mensagem ao cliente"); sem unidade conhecida o VPS roteia pelo DDD.
  // autor 'atendente': é um humano encaminhando — o bot PAUSA a IA daquela conversa.
  const envio = await enviarMediaWhatsApp(
    telefone,
    { base64: origem.buffer.toString('base64'), filename: nome, mimetype: tipo.contentType },
    caption ?? '',
    instanciaDaUnidade(auth.usuario.unidade),
    'atendente',
  )
  if (!envio.ok) {
    // Cada falha pede um conselho diferente — e o 'timeout' JAMAIS pode virar
    // "tente novamente" (duplicaria a mídia no WhatsApp do destinatário).
    const f = falhaEnvioNumero(envio)
    return jsonError(f.erro, f.status)
  }

  // LGPD: metadata só com ids/códigos — o número NUNCA entra (só o DDD).
  await logAudit({
    tenantId: auth.usuario.tenant_id,
    userId: auth.usuario.id,
    action: 'conversas.anexo_encaminhado',
    resourceType: 'conversa',
    resourceId: origemConversaId != null ? String(origemConversaId) : null,
    metadata: {
      destino: 'numero',
      ddd: dddDoDestino(telefone),
      clienteId: clienteId ?? null,
      contentType: tipo.contentType,
      tamanho: origem.buffer.length,
    },
  })

  return NextResponse.json({ ok: true })
}
