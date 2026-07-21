'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { AnexosClientePicker, type ItemAnexo } from '@/components/clientes/AnexosClientePicker'
import { apenasDigitos } from '@/lib/conversas/telefone'
import { OPCOES_INSTANCIA, instanciaDaUnidade, type Instancia } from '@/lib/conversas/instancia'
import { Send, MessageCircle } from 'lucide-react'

// Valor do select: '' = automático (roteia pelo DDD); senão a instância explícita.
type EscolhaInstancia = '' | Instancia
const VALORES_INSTANCIA = OPCOES_INSTANCIA.map((o) => o.value)
const chaveLocal = (userId: string) => `simas.wa.instancia.${userId}`

/**
 * Botão + modal "Enviar mensagem ao cliente" reutilizável em QUALQUER tela com um
 * cliente selecionado (dossiê, Estudo de Caso, caso). Pedido do dono: enviar
 * WhatsApp e anexar documentos do caso sem trocar de tela.
 *
 * - COM atendimentoId → mesma rota do caso (registra no diário do atendimento).
 * - SEM atendimentoId → rota POR CLIENTE (/api/clientes/[id]/whatsapp): só
 *   auditoria, sem diário (não há caso). O telefone vem do cadastro, editável no
 *   modal — tudo sai pelo canal do bot, então vale qualquer número.
 *
 * O picker de anexos (AnexosClientePicker) lista documentos + peças do cliente; o
 * servidor valida que cada anexo é do MESMO cliente antes de enviar.
 */
export function EnviarMensagemCliente({
  clienteId,
  clienteNome,
  telefone,
  atendimentoId,
  variant = 'secondary',
  size = 'md',
  className,
  label = 'Mensagem',
}: {
  clienteId: string
  clienteNome?: string
  /** Telefone do cadastro para pré-preencher (editável). Ausente → busca ao abrir. */
  telefone?: string | null
  /** Presente → envia pela rota do caso (grava diário). Ausente → rota por cliente. */
  atendimentoId?: string
  variant?: 'secondary' | 'ghost' | 'default'
  size?: 'sm' | 'md' | 'lg'
  className?: string
  label?: string
}) {
  const [aberto, setAberto] = useState(false)
  return (
    <>
      <Button variant={variant} size={size} className={className} onClick={() => setAberto(true)}>
        <MessageCircle className="h-4 w-4" />
        {label}
      </Button>
      {aberto && (
        <ModalMensagem
          clienteId={clienteId}
          clienteNome={clienteNome}
          telefoneInicial={telefone ?? null}
          atendimentoId={atendimentoId}
          onFechar={() => setAberto(false)}
        />
      )}
    </>
  )
}

function ModalMensagem({
  clienteId,
  clienteNome,
  telefoneInicial,
  atendimentoId,
  onFechar,
}: {
  clienteId: string
  clienteNome?: string
  telefoneInicial: string | null
  atendimentoId?: string
  onFechar: () => void
}) {
  const router = useRouter()
  const { success, error: toastError } = useToast()
  const [tel, setTel] = useState((telefoneInicial ?? '').trim())
  const [buscandoTel, setBuscandoTel] = useState(false)
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [selecionados, setSelecionados] = useState<ItemAnexo[]>([])
  // Número de saída: default pela unidade do usuário; localStorage lembra a última
  // escolha por usuário (conveniência — não substitui o default por unidade).
  const [instancia, setInstancia] = useState<EscolhaInstancia>('')
  const [usuarioId, setUsuarioId] = useState<string | null>(null)
  // A escolha só é ENVIADA quando explícita (localStorage ou clique). O pré-select
  // por unidade é só visual: sem escolha explícita, omitimos `instancia` e a ROTA
  // aplica o default pela unidade — evita forçar DDD se o perfil demorar/falhar.
  const [escolhaExplicita, setEscolhaExplicita] = useState(false)

  // Ao abrir, busca a unidade do usuário logado para pré-selecionar o número de
  // saída (localStorage tem prioridade se houver escolha salva). Best-effort.
  useEffect(() => {
    let cancelado = false
    fetch('/api/usuarios/perfil')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelado || !d?.usuario) return
        const id = d.usuario.id as string
        setUsuarioId(id)
        const salvo = typeof window !== 'undefined' ? window.localStorage.getItem(chaveLocal(id)) : null
        if (salvo !== null && VALORES_INSTANCIA.includes(salvo as EscolhaInstancia)) {
          setInstancia(salvo as EscolhaInstancia)
          setEscolhaExplicita(true) // escolha salva = explícita → é enviada
        } else {
          // Só visual: a rota deriva o default pela unidade (não marca explícita).
          setInstancia(instanciaDaUnidade(d.usuario.unidade ?? null) ?? '')
        }
      })
      .catch(() => { /* silencioso — fica no automático (DDD) */ })
    return () => { cancelado = true }
  }, [])

  function trocarInstancia(v: EscolhaInstancia) {
    setInstancia(v)
    setEscolhaExplicita(true) // troca manual = explícita → respeitada no envio
    if (usuarioId && typeof window !== 'undefined') window.localStorage.setItem(chaveLocal(usuarioId), v)
  }

  // Sem telefone conhecido (ex.: Estudo de Caso só tem id/nome) → busca no cadastro
  // ao abrir para pré-preencher o campo (editável). Best-effort.
  useEffect(() => {
    if (telefoneInicial && telefoneInicial.trim()) return
    let cancelado = false
    setBuscandoTel(true)
    fetch(`/api/clientes/${clienteId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelado || !d) return
        const t = (d.cliente?.telefone as string | null) ?? ''
        if (t) setTel(t.trim())
      })
      .catch(() => { /* silencioso — o campo fica editável */ })
      .finally(() => { if (!cancelado) setBuscandoTel(false) })
    return () => { cancelado = true }
  }, [clienteId, telefoneInicial])

  const nome = clienteNome ?? 'cliente'
  const textoTrim = texto.trim()
  const textoValido = textoTrim.length >= 5
  const temAnexos = selecionados.length > 0
  const telValido = apenasDigitos(tel).length >= 10
  // Com anexos, o texto é OPCIONAL (vira legenda). Se digitado, precisa 5+.
  const podeEnviar = !enviando && telValido && (textoValido || (temAnexos && textoTrim.length === 0))

  function fechar() {
    if (enviando) return
    onFechar()
  }

  async function enviar() {
    if (!podeEnviar) return
    setEnviando(true)
    try {
      const body: {
        texto?: string
        telefone?: string
        anexos?: Array<{ documentoId?: string; pecaId?: string }>
        instancia?: Instancia | null
      } = {}
      if (textoValido) body.texto = textoTrim
      if (temAnexos) {
        body.anexos = selecionados.map((s) => (s.origem === 'peca' ? { pecaId: s.id } : { documentoId: s.id }))
      }
      // A rota por cliente usa o telefone editado; a rota do caso o ignora (usa o
      // do cadastro) — enviar sempre é inofensivo (zod descarta o extra).
      body.telefone = tel.trim()
      // Número de saída: só envia se explícito ('' → null = automático/DDD; senão a
      // instância). Sem escolha explícita, omite → a rota aplica o default por unidade.
      if (escolhaExplicita) body.instancia = instancia === '' ? null : instancia

      const url = atendimentoId
        ? `/api/atendimentos/${atendimentoId}/whatsapp`
        : `/api/clientes/${clienteId}/whatsapp`
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const d = (await r.json().catch(() => ({}))) as { error?: string }
      if (!r.ok) {
        toastError('Não enviado', d.error ?? 'Tente novamente.')
        return
      }
      success(
        'Mensagem enviada!',
        temAnexos
          ? `WhatsApp com ${selecionados.length} documento${selecionados.length > 1 ? 's' : ''} enviado para ${nome}.`
          : `WhatsApp enviado para ${nome}.`,
      )
      onFechar()
      router.refresh() // atualiza diário/histórico se a tela mostrar
    } catch {
      toastError('Não enviado', 'Falha de rede. Tente novamente.')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog
      open
      onClose={fechar}
      title="Enviar WhatsApp ao cliente"
      description={clienteNome}
      footer={
        <>
          <Button variant="secondary" size="md" onClick={fechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button size="md" onClick={enviar} loading={enviando} disabled={!podeEnviar}>
            <Send className="h-4 w-4" />
            Enviar
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Input
          label="WhatsApp do cliente"
          value={tel}
          onChange={(e) => setTel(e.target.value)}
          placeholder={buscandoTel ? 'Carregando telefone…' : '(61) 99999-9999'}
          inputMode="tel"
          disabled={enviando}
          error={tel.trim() && !telValido ? 'Informe DDD + número.' : undefined}
          hint="Enviado pelo número do escritório — pode ser qualquer número."
        />

        <Textarea
          label="Mensagem"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); void enviar() }
          }}
          maxLength={2000}
          rows={4}
          placeholder={
            temAnexos
              ? 'Opcional: esta mensagem vira a legenda do primeiro documento.'
              : 'Ex.: Olá! Para darmos andamento, precisamos da foto do seu RG e do comprovante de residência. Pode enviar por aqui mesmo?'
          }
          disabled={enviando}
        />

        <AnexosClientePicker
          clienteId={clienteId}
          selecionados={selecionados}
          onChange={setSelecionados}
          disabled={enviando}
        />

        {/* Número de saída — discreto; default pela unidade do usuário. */}
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>Enviará pelo:</span>
          <select
            value={instancia}
            onChange={(e) => trocarInstancia(e.target.value as EscolhaInstancia)}
            disabled={enviando}
            className="rounded-md border border-border bg-card px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
          >
            {OPCOES_INSTANCIA.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
    </Dialog>
  )
}
