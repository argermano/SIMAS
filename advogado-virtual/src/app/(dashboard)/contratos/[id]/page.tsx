import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { EditorContratoClient } from './EditorContratoClient'
import { ChevronLeft } from 'lucide-react'

export const metadata = { title: 'Contrato de Honorários' }
export const dynamic = 'force-dynamic'

type ContratoDetalhe = {
  id: string
  titulo: string
  area: string | null
  conteudo_markdown: string
  status: string
  versao: number
  valor_fixo: number | null
  percentual_exito: number | null
  forma_pagamento: string | null
  clientes: { nome: string; cpf?: string; email?: string; telefone?: string } | null
  atendimentos: { area?: string } | null
}

type TenantProfissional = {
  nome_responsavel?: string | null
  email_profissional?: string | null
  cpf_responsavel?: string | null
  telefone?: string | null
}

export default async function ContratoPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome, role, tenant_id')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  const [{ data: contrato }, { data: tenant }] = await Promise.all([
    supabase
      .from('contratos_honorarios')
      .select('*, clientes(nome, cpf, email, telefone), atendimentos(area)')
      .eq('id', id)
      .eq('tenant_id', usuario.tenant_id)
      .single(),
    supabase
      .from('tenants')
      .select('nome_responsavel, email_profissional, cpf_responsavel, telefone')
      .eq('id', usuario.tenant_id)
      .single(),
  ])

  if (!contrato) notFound()

  const [{ data: versoes }, { data: assinatura }] = await Promise.all([
    supabase
      .from('contratos_versoes')
      .select('id, versao, created_at')
      .eq('contrato_id', id)
      .order('versao', { ascending: false }),
    supabase
      .from('contract_signatures')
      .select('*, contract_signature_signers(*)')
      .eq('contrato_id', id)
      .eq('tenant_id', usuario.tenant_id)
      .neq('status', 'cancelled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return (
    <>
      <Header
        titulo={(contrato as ContratoDetalhe).titulo}
        subtitulo={`Cliente: ${(contrato as ContratoDetalhe).clientes?.nome ?? '—'} · Status: ${contrato.status}`}
        nomeUsuario={usuario.nome ?? user.email ?? 'Usuário'}
        acoes={
          <Link
            href="/contratos"
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" />
            Contratos
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-5xl">
          <EditorContratoClient
            contratoId={id}
            contrato={contrato as ContratoDetalhe}
            versoes={(versoes ?? []) as { id: string; versao: number; created_at: string }[]}
            role={usuario.role}
            assinatura={assinatura ?? null}
            tenant={(tenant as TenantProfissional) ?? null}
          />
        </div>
      </main>
    </>
  )
}
