'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { Pencil, Trash2 } from 'lucide-react'

interface ClienteAcoesClientProps {
  clienteId:   string
  clienteNome: string
}

export function ClienteAcoesClient({ clienteId, clienteNome }: ClienteAcoesClientProps) {
  const router  = useRouter()
  const { success, error } = useToast()

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [loading, setLoading]         = useState(false)

  async function excluir() {
    setLoading(true)
    try {
      const res = await fetch(`/api/clientes/${clienteId}`, { method: 'DELETE' })
      if (!res.ok) {
        const json = await res.json()
        error('Erro ao excluir', json.error ?? 'Tente novamente.')
        return
      }
      success('Cliente excluído', `${clienteNome} foi removido do sistema.`)
      router.push('/clientes')
      router.refresh()
    } finally {
      setLoading(false)
      setConfirmOpen(false)
    }
  }

  return (
    <>
      <Button asChild variant="secondary" size="md">
        <Link href={`/clientes/${clienteId}/editar`}>
          <Pencil className="h-4 w-4" />
          Editar
        </Link>
      </Button>

      <Button
        variant="secondary"
        size="md"
        className="text-red-600 border-red-300 hover:bg-red-50"
        onClick={() => setConfirmOpen(true)}
      >
        <Trash2 className="h-4 w-4" />
        Excluir
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={excluir}
        title="Excluir cliente"
        description={`Tem certeza que deseja excluir "${clienteNome}"? Todos os atendimentos e documentos serão removidos permanentemente. Esta ação não pode ser desfeita.`}
        confirmLabel="Sim, excluir"
        cancelLabel="Cancelar"
        variant="danger"
        loading={loading}
      />
    </>
  )
}
