'use client'

import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { AlertCircle, UserPen } from 'lucide-react'
import type { CampoCliente } from '@/lib/documentos/campos-cliente'

// Opções usuais de estado civil (pt-BR).
const OPCOES_ESTADO_CIVIL = [
  { value: 'Solteiro(a)',   label: 'Solteiro(a)' },
  { value: 'Casado(a)',     label: 'Casado(a)' },
  { value: 'Divorciado(a)', label: 'Divorciado(a)' },
  { value: 'Separado(a)',   label: 'Separado(a)' },
  { value: 'Viúvo(a)',      label: 'Viúvo(a)' },
  { value: 'União estável', label: 'União estável' },
]

// Máscaras leves — só cosmética; o cadastro guarda o valor já formatado.
function mascararCpf(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length > 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  if (d.length > 6) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  if (d.length > 3) return `${d.slice(0, 3)}.${d.slice(3)}`
  return d
}
function mascararCep(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}
function mascararUf(v: string): string {
  return v.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 2)
}

function aplicarMascara(tipo: CampoCliente['tipo'], valor: string): string {
  if (tipo === 'cpf') return mascararCpf(valor)
  if (tipo === 'cep') return mascararCep(valor)
  if (tipo === 'uf') return mascararUf(valor)
  return valor
}

interface CompletarDadosClienteProps {
  clienteId: string
  /** Campos DO CLIENTE que o documento usa e estão vazios (de camposFaltantes). */
  campos: CampoCliente[]
  /** Recebe { coluna: valor } dos campos efetivamente salvos, para o pai atualizar o cliente em memória. */
  onSalvo: (camposAtualizados: Record<string, string>) => void
}

/**
 * Pede ao atendente os dados do cliente que faltam para o documento e grava no cadastro
 * (PATCH parcial — só os campos preenchidos). Assim a informação não se perde nem precisa
 * ser redigitada a cada geração. Compartilhado por modelos e contrato.
 */
export function CompletarDadosCliente({ clienteId, campos, onSalvo }: CompletarDadosClienteProps) {
  const { success, error: toastError } = useToast()
  const [valores, setValores] = useState<Record<string, string>>({})
  const [salvando, setSalvando] = useState(false)

  if (campos.length === 0) return null

  function setValor(campo: string, tipo: CampoCliente['tipo'], bruto: string) {
    setValores((v) => ({ ...v, [campo]: aplicarMascara(tipo, bruto) }))
  }

  // Só os campos com valor não-vazio (PATCH parcial não pode zerar o que não foi tocado).
  const preenchidos = campos.filter((c) => (valores[c.campo] ?? '').trim() !== '')

  async function salvar() {
    // UF exige 2 letras (schema do PATCH: length 2) — evita 400 desnecessário.
    const ufInvalida = preenchidos.find((c) => c.tipo === 'uf' && (valores[c.campo] ?? '').length !== 2)
    if (ufInvalida) {
      toastError('UF inválida', 'Informe a UF com 2 letras (ex.: PR).')
      return
    }

    const payload: Record<string, string> = {}
    for (const c of preenchidos) payload[c.campo] = valores[c.campo].trim()

    setSalvando(true)
    try {
      const res = await fetch(`/api/clientes/${clienteId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok) {
        toastError('Erro', d.error ?? 'Não foi possível salvar no cadastro')
        return
      }
      success('Dados salvos no cadastro', 'O documento vai usar as informações atualizadas.')
      onSalvo(payload)
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950/40">
      <div className="flex items-start gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          Alguns dados do cliente usados neste documento estão em branco. Preencha para atualizar o
          cadastro e não precisar informar de novo.
        </p>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {campos.map((c) =>
          c.tipo === 'select-estado-civil' ? (
            <Select
              key={c.placeholder}
              label={c.label}
              value={valores[c.campo] ?? ''}
              onChange={(e) => setValor(c.campo, c.tipo, e.target.value)}
              options={OPCOES_ESTADO_CIVIL}
              placeholder="Selecione…"
            />
          ) : (
            <Input
              key={c.placeholder}
              label={c.label}
              value={valores[c.campo] ?? ''}
              onChange={(e) => setValor(c.campo, c.tipo, e.target.value)}
              inputMode={c.tipo === 'cpf' || c.tipo === 'cep' ? 'numeric' : undefined}
              placeholder={c.tipo === 'uf' ? 'Ex.: PR' : undefined}
            />
          ),
        )}
      </div>

      <div className="mt-4 flex justify-end">
        <Button
          size="sm"
          onClick={salvar}
          loading={salvando}
          disabled={preenchidos.length === 0 || salvando}
          className="gap-1.5"
        >
          <UserPen className="h-4 w-4" />
          Salvar no cadastro
        </Button>
      </div>
    </div>
  )
}
