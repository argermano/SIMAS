import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Building2, User, Shield, CreditCard, Users, ChevronLeft, Briefcase } from 'lucide-react'
import { formatarData } from '@/lib/utils'
import { LABELS_ROLE } from '@/types'
import { FormPerfilProfissional } from '@/components/configuracoes/FormPerfilProfissional'

export const metadata = { title: 'Configurações' }

const LABELS_PLANO: Record<string, string> = {
  trial:         'Trial (gratuito)',
  basico:        'Básico',
  profissional:  'Profissional',
}

export default async function ConfiguracoesPage() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('id, nome, email, role, status, created_at, tenant_id, oab_numero, oab_estado, telefone_profissional, email_profissional, endereco_profissional, cidade_profissional, estado_profissional, cep_profissional, tenants(nome, cnpj, plano, status, created_at)')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  const tenant = usuario.tenants as {
    nome?: string; cnpj?: string; plano?: string; status?: string; created_at?: string
  } | null

  return (
    <>
      <Header
        titulo="Configurações"
        subtitulo="Informações do escritório e da conta"
        nomeUsuario={usuario.nome}
        acoes={
          <Link
            href="/dashboard"
            className="flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
            Início
          </Link>
        }
      />

      <main className="flex-1 overflow-y-auto p-6">
        <div className="mx-auto max-w-3xl space-y-6">

          {/* Escritório */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-gray-400" />
                Escritório
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <InfoItem label="Nome do escritório" valor={tenant?.nome ?? '—'} />
              <InfoItem label="CNPJ" valor={tenant?.cnpj ?? 'Não informado'} />
              <InfoItem
                label="Plano atual"
                valor={
                  <Badge variant={tenant?.plano === 'profissional' ? 'success' : 'warning'}>
                    {LABELS_PLANO[tenant?.plano ?? 'trial'] ?? tenant?.plano}
                  </Badge>
                }
              />
              <InfoItem
                label="Status"
                valor={
                  <Badge variant={tenant?.status === 'ativo' ? 'success' : 'danger'}>
                    {tenant?.status === 'ativo' ? 'Ativo' : (tenant?.status ?? '—')}
                  </Badge>
                }
              />
              {tenant?.created_at && (
                <InfoItem label="Cliente desde" valor={formatarData(tenant.created_at)} />
              )}
            </CardContent>
          </Card>

          {/* Minha conta */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-gray-400" />
                Minha Conta
              </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <InfoItem label="Nome" valor={usuario.nome} />
              <InfoItem label="E-mail" valor={usuario.email} />
              <InfoItem
                label="Perfil de acesso"
                valor={
                  <Badge variant="default">
                    {LABELS_ROLE[usuario.role as keyof typeof LABELS_ROLE] ?? usuario.role}
                  </Badge>
                }
              />
              <InfoItem label="Membro desde" valor={formatarData(usuario.created_at)} />
            </CardContent>
          </Card>

          {/* Perfil profissional */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-gray-400" />
                Perfil Profissional
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-gray-500">
                Esses dados são usados automaticamente na geração de contratos de honorários.
              </p>
              <FormPerfilProfissional usuario={{
                oab_numero:            usuario.oab_numero            ?? undefined,
                oab_estado:            usuario.oab_estado            ?? undefined,
                telefone_profissional: usuario.telefone_profissional ?? undefined,
                email_profissional:    usuario.email_profissional    ?? undefined,
                endereco_profissional: usuario.endereco_profissional ?? undefined,
                cidade_profissional:   usuario.cidade_profissional   ?? undefined,
                estado_profissional:   usuario.estado_profissional   ?? undefined,
                cep_profissional:      usuario.cep_profissional      ?? undefined,
              }} />
            </CardContent>
          </Card>

          {/* Gestão de equipe — apenas admin */}
          {usuario.role === 'admin' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-gray-400" />
                  Gestão de Equipe
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <p className="text-sm text-gray-500">
                  Convide colaboradores e gerencie os perfis de acesso do escritório.
                </p>
                <Button asChild variant="secondary" size="sm">
                  <Link href="/configuracoes/equipe">Gerenciar equipe</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Segurança */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5 text-gray-400" />
                Segurança e Privacidade
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-gray-600">
              <p className="flex items-start gap-2">
                <span className="mt-0.5 text-green-600">✓</span>
                Dados transmitidos com criptografia TLS
              </p>
              <p className="flex items-start gap-2">
                <span className="mt-0.5 text-green-600">✓</span>
                Dados sensíveis (CPF) armazenados com criptografia
              </p>
              <p className="flex items-start gap-2">
                <span className="mt-0.5 text-green-600">✓</span>
                Isolamento total entre escritórios (Row Level Security)
              </p>
              <p className="flex items-start gap-2">
                <span className="mt-0.5 text-green-600">✓</span>
                Chave de IA nunca exposta ao navegador
              </p>
              <p className="flex items-start gap-2">
                <span className="mt-0.5 text-blue-600">ℹ</span>
                Em conformidade com a LGPD (Lei 13.709/2018)
              </p>
            </CardContent>
          </Card>

          {/* Plano */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-gray-400" />
                Plano e Uso
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
                <p className="text-base font-semibold text-amber-900">
                  Você está no plano Trial
                </p>
                <p className="mt-1 text-sm text-amber-700">
                  O plano trial permite testar todas as funcionalidades.
                  Em breve, planos pagos estarão disponíveis.
                </p>
              </div>
            </CardContent>
          </Card>

        </div>
      </main>
    </>
  )
}

function InfoItem({
  label,
  valor,
}: {
  label: string
  valor: React.ReactNode
}) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <div className="mt-1 text-base text-gray-900">{valor}</div>
    </div>
  )
}
