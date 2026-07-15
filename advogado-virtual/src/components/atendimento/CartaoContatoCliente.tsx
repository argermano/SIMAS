'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { formatarTelefone } from '@/lib/utils'
import { apenasDigitos } from '@/lib/conversas/telefone'
import { EnviarWhatsAppModal } from './EnviarWhatsAppModal'
import { UserRound, Phone, Mail, MessageSquare, Pencil, Check, X, Loader2 } from 'lucide-react'

interface CartaoContatoClienteProps {
  clienteId: string
  atendimentoId: string
  nome: string
  telefoneInicial: string | null
  email: string | null
}

// Formata p/ exibição só quando são 10/11 dígitos (BR local); um número com DDI
// (12/13) fica como está para não sair torto no formatarTelefone.
function exibirTelefone(tel: string): string {
  const d = apenasDigitos(tel)
  return d.length === 10 || d.length === 11 ? formatarTelefone(tel) : tel
}

/**
 * Cartão de contato do cliente na sidebar do caso (padrão Astrea): nome com link
 * para o dossiê, telefone/WhatsApp e e-mail. Permite informar/editar o telefone
 * inline (PATCH parcial no cadastro do cliente — só o campo telefone) e ENVIAR
 * WhatsApp ao cliente daqui mesmo (modal — o dono não quis trocar de tela),
 * útil quando falta um documento ou há um pedido extra ao cliente.
 */
export function CartaoContatoCliente({ clienteId, atendimentoId, nome, telefoneInicial, email }: CartaoContatoClienteProps) {
  const { success, error: toastError } = useToast()
  const [telefone, setTelefone] = useState((telefoneInicial ?? '').trim())
  const [editando, setEditando] = useState(false)
  const [rascunho, setRascunho] = useState((telefoneInicial ?? '').trim())
  const [salvando, setSalvando] = useState(false)
  const [modalWhatsApp, setModalWhatsApp] = useState(false)

  const digitos = apenasDigitos(telefone)
  const temTelefone = digitos.length >= 10
  // Campo aberto quando o usuário clica em editar OU quando ainda não há telefone.
  const editandoCampo = editando || !temTelefone

  async function salvar() {
    const dig = apenasDigitos(rascunho)
    if (dig.length < 10 || dig.length > 11) {
      toastError('Telefone inválido', 'Informe DDD + número, ex.: (61) 99999-9999.')
      return
    }
    const formatado = formatarTelefone(dig)
    setSalvando(true)
    try {
      // PATCH parcial: o schema aceita só { telefone } (demais campos opcionais).
      const res = await fetch(`/api/clientes/${clienteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telefone: formatado }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        toastError('Não foi possível salvar', (d as { error?: string } | null)?.error ?? 'Tente novamente.')
        return
      }
      setTelefone(formatado)
      setEditando(false)
      success('Telefone salvo', 'Agora você pode enviar WhatsApp ao cliente daqui.')
    } catch {
      toastError('Erro', 'Falha de rede. Tente novamente.')
    } finally {
      setSalvando(false)
    }
  }

  function cancelar() {
    setEditando(false)
    setRascunho(telefone)
  }


  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <UserRound className="h-4 w-4 text-muted-foreground" />
          Contato
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Nome → dossiê do cliente */}
        <Link
          href={`/clientes/${clienteId}`}
          className="block truncate text-sm font-semibold text-foreground hover:text-primary hover:underline"
          title={nome}
        >
          {nome}
        </Link>

        {/* Telefone / WhatsApp */}
        <div className="space-y-2">
          {editandoCampo ? (
            <div className="flex items-center gap-1.5">
              <input
                value={rascunho}
                onChange={(e) => setRascunho(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); void salvar() }
                  if (e.key === 'Escape' && temTelefone) cancelar()
                }}
                placeholder="(61) 99999-9999"
                inputMode="tel"
                aria-label="Telefone do cliente"
                autoFocus={editando}
                disabled={salvando}
                className="h-9 min-w-0 flex-1 rounded-lg border border-input bg-background px-2.5 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              />
              <button
                onClick={() => void salvar()}
                disabled={salvando}
                title="Salvar telefone"
                aria-label="Salvar telefone"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </button>
              {temTelefone && (
                <button
                  onClick={cancelar}
                  disabled={salvando}
                  title="Cancelar"
                  aria-label="Cancelar edição do telefone"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">{exibirTelefone(telefone)}</span>
              </span>
              <button
                onClick={() => { setRascunho(telefone); setEditando(true) }}
                title="Editar telefone"
                aria-label="Editar telefone"
                className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Enviar WhatsApp — modal na própria tela (o dono não quis navegar) */}
          <button
            onClick={() => temTelefone && setModalWhatsApp(true)}
            disabled={!temTelefone}
            title={temTelefone ? 'Enviar uma mensagem de WhatsApp ao cliente sem sair desta tela' : 'Informe o telefone para enviar WhatsApp'}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
          >
            <MessageSquare className="h-4 w-4" />
            Enviar WhatsApp
          </button>

          {modalWhatsApp && (
            <EnviarWhatsAppModal
              aberto={modalWhatsApp}
              onFechar={() => setModalWhatsApp(false)}
              atendimentoId={atendimentoId}
              clienteNome={nome}
              telefoneExibicao={exibirTelefone(telefone)}
            />
          )}
        </div>

        {/* E-mail */}
        {email && (
          <a
            href={`mailto:${email}`}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            title={email}
          >
            <Mail className="h-4 w-4 shrink-0" />
            <span className="truncate">{email}</span>
          </a>
        )}
      </CardContent>
    </Card>
  )
}
