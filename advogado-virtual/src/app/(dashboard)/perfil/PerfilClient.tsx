'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { apenasDigitos } from '@/lib/funil/telefone'
import { formatarCelularBR, celularValidoBR } from '@/lib/format/celular'
import {
  CATALOGO_NOTIFICACOES,
  TIPOS_NOTIFICACAO,
  type CanalPrefs,
  type TipoNotificacao,
} from '@/lib/notificacoes/catalogo'
import { User, Mail, MessageCircle, Bell, Save, MapPin } from 'lucide-react'

const ROTULO_UNIDADE: Record<string, string> = {
  brasilia: 'Brasília',
  florianopolis: 'Florianópolis',
  blumenau: 'Blumenau',
}

type Prefs = Record<TipoNotificacao, CanalPrefs>

interface PerfilInicial {
  nome: string
  email: string
  celular: string | null
  unidade: string | null
  notificacoes: Prefs
}

// ── Switch acessível (sem dependência externa) ───────────────────────────────
function Switch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        checked ? 'bg-primary' : 'bg-muted',
        disabled && 'cursor-not-allowed opacity-40',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-6' : 'translate-x-1',
        )}
      />
    </button>
  )
}

export function PerfilClient({ inicial }: { inicial: PerfilInicial }) {
  const router = useRouter()
  const { success, error: toastError } = useToast()

  const [nome, setNome] = useState(inicial.nome)
  const [celular, setCelular] = useState(formatarCelularBR(inicial.celular ?? ''))
  const [prefs, setPrefs] = useState<Prefs>(inicial.notificacoes)
  const [salvando, setSalvando] = useState(false)

  const temCelular = apenasDigitos(celular).length >= 10

  function setCanal(tipo: TipoNotificacao, canal: keyof CanalPrefs, valor: boolean) {
    setPrefs((p) => ({ ...p, [tipo]: { ...p[tipo], [canal]: valor } }))
  }

  async function salvar() {
    if (nome.trim() === '') {
      toastError('Nome obrigatório', 'Informe seu nome.')
      return
    }
    if (!celularValidoBR(celular)) {
      toastError('Celular inválido', 'Informe DDD + número (ex.: (61) 99999-0000) ou deixe em branco.')
      return
    }
    setSalvando(true)
    try {
      const res = await fetch('/api/perfil', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nome.trim(), celular: apenasDigitos(celular), notificacoes: prefs }),
      })
      const data = await res.json()
      if (!res.ok) {
        toastError('Erro', data.error ?? 'Falha ao salvar o perfil')
        return
      }
      // Reidrata do servidor (preferências efetivas + celular normalizado).
      setPrefs(data.usuario.notificacoes as Prefs)
      setCelular(formatarCelularBR(data.usuario.celular ?? ''))
      setNome(data.usuario.nome ?? '')
      success('Perfil salvo', 'Seus dados e preferências foram atualizados.')
      router.refresh()
    } finally {
      setSalvando(false)
    }
  }

  return (
    <>
      {/* ── Meus dados ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5 text-primary" />
            Meus dados
          </CardTitle>
          <CardDescription>Nome e celular você mesmo edita; e-mail e unidade são definidos pelo escritório.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            label="Nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            maxLength={200}
            disabled={salvando}
          />

          <div className="w-full space-y-1.5">
            <label className="text-sm font-medium text-foreground">E-mail</label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <Mail className="h-4 w-4 shrink-0" />
              <span className="truncate">{inicial.email || '—'}</span>
            </div>
          </div>

          <Input
            label="Celular (WhatsApp)"
            type="tel"
            inputMode="numeric"
            value={celular}
            onChange={(e) => setCelular(formatarCelularBR(e.target.value))}
            placeholder="(00) 00000-0000"
            hint="Usado para os avisos por WhatsApp. Deixe em branco para não receber por esse canal."
            disabled={salvando}
          />

          <div className="w-full space-y-1.5">
            <label className="text-sm font-medium text-foreground">Unidade</label>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0" />
              <span>{inicial.unidade ? ROTULO_UNIDADE[inicial.unidade] ?? inicial.unidade : 'Sem unidade definida'}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Notificações ──────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-primary" />
            Notificações
          </CardTitle>
          <CardDescription>Escolha o que você recebe e por quais canais.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-3 text-left font-medium">Comunicação</th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <Mail className="h-4 w-4" /> E-mail
                    </span>
                  </th>
                  <th className="px-3 py-2 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <MessageCircle className="h-4 w-4" /> WhatsApp
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {TIPOS_NOTIFICACAO.map((tipo) => {
                  const item = CATALOGO_NOTIFICACOES[tipo]
                  return (
                    <tr key={tipo}>
                      <td className="py-3 pr-3">
                        <p className="font-medium text-foreground">{item.rotulo}</p>
                        <p className="text-xs text-muted-foreground">{item.descricao}</p>
                      </td>
                      <td className="px-3 text-center">
                        <div className="flex justify-center">
                          <Switch
                            checked={prefs[tipo].email}
                            onChange={(v) => setCanal(tipo, 'email', v)}
                            label={`${item.rotulo} por e-mail`}
                            disabled={salvando}
                          />
                        </div>
                      </td>
                      <td className="px-3 text-center">
                        <div className="flex justify-center">
                          <Switch
                            checked={prefs[tipo].whatsapp}
                            onChange={(v) => setCanal(tipo, 'whatsapp', v)}
                            label={`${item.rotulo} por WhatsApp`}
                            disabled={salvando || !temCelular}
                          />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {!temCelular && (
            <p className="mt-3 text-xs text-warning">
              Cadastre seu celular acima para habilitar os avisos por WhatsApp.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={salvar} loading={salvando} disabled={salvando}>
          <Save className="mr-2 h-4 w-4" />
          Salvar alterações
        </Button>
      </div>
    </>
  )
}
