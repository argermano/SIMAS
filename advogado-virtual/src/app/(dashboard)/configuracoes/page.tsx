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
    .select('id, nome, email, role, status, created_at, tenant_id, tenants(nome, cnpj, plano, status, created_at, oab_numero, oab_estado, cpf_responsavel, rg_responsavel, orgao_expedidor, estado_civil, nacionalidade, nome_responsavel, telefone, email_profissional, endereco, bairro, cidade, estado, cep)')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) redirect('/login')

  const tenant = usuario.tenants as {
    nome?: string; cnpj?: string; plano?: string; status?: string; created_at?: string
    oab_numero?: string; oab_estado?: string; cpf_responsavel?: string; rg_responsavel?: string
    orgao_expedidor?: string; estado_civil?: string; nacionalidade?: string; nome_responsavel?: string
    telefone?: string; email_profissional?: string; endereco?: string; bairro?: string
    cidade?: string; estado?: string; cep?: string
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
            className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
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
                <Building2 className="h-5 w-5 text-muted-foreground" />
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
                <User className="h-5 w-5 text-muted-foreground" />
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

          {/* Dados profissionais do escritório */}
          {usuario.role === 'admin' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="h-5 w-5 text-muted-foreground" />
                Dados Profissionais do Escritório
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">
                Esses dados são usados automaticamente na geração de contratos de honorários. Preenchidos uma vez, valem para todos os contratos do escritório.
              </p>
              <FormPerfilProfissional escritorio={{
                nome_responsavel:   tenant?.nome_responsavel   ?? undefined,
                oab_numero:         tenant?.oab_numero         ?? undefined,
                oab_estado:         tenant?.oab_estado         ?? undefined,
                cpf_responsavel:    tenant?.cpf_responsavel    ?? undefined,
                rg_responsavel:     tenant?.rg_responsavel     ?? undefined,
                orgao_expedidor:    tenant?.orgao_expedidor    ?? undefined,
                estado_civil:       tenant?.estado_civil       ?? undefined,
                nacionalidade:      tenant?.nacionalidade      ?? undefined,
                telefone:           tenant?.telefone           ?? undefined,
                email_profissional: tenant?.email_profissional ?? undefined,
                endereco:           tenant?.endereco           ?? undefined,
                bairro:             tenant?.bairro             ?? undefined,
                cidade:             tenant?.cidade             ?? undefined,
                estado:             tenant?.estado             ?? undefined,
                cep:                tenant?.cep                ?? undefined,
              }} />
            </CardContent>
          </Card>
          )}

          {/* Gestão de equipe — apenas admin */}
          {usuario.role === 'admin' && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5 text-muted-foreground" />
                  Gestão de Equipe
                </CardTitle>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
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
                <Shield className="h-5 w-5 text-muted-foreground" />
                Segurança e Privacidade
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p className="flex items-start gap-2">
                <span className="mt-0.5 text-success">✓</span>
                Dados transmitidos com criptografia TLS
              </p>
              <p className="flex items-start gap-2">
                <span className="mt-0.5 text-success">✓</span>
                Dados sensíveis (CPF) armazenados com criptografia
              </p>
              <p className="flex items-start gap-2">
                <span className="mt-0.5 text-success">✓</span>
                Isolamento total entre escritórios (Row Level Security)
              </p>
              <p className="flex items-start gap-2">
                <span className="mt-0.5 text-success">✓</span>
                Chave de IA nunca exposta ao navegador
              </p>
              <p className="flex items-start gap-2">
                <span className="mt-0.5 text-info">ℹ</span>
                Em conformidade com a LGPD (Lei 13.709/2018)
              </p>
            </CardContent>
          </Card>

          {/* Plano */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-muted-foreground" />
                Plano e Uso
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-lg bg-warning/5 border border-warning/20 p-4">
                <p className="text-base font-semibold text-warning">
                  Você está no plano Trial
                </p>
                <p className="mt-1 text-sm text-warning">
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
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-base text-foreground">{valor}</div>
    </div>
  )
}
