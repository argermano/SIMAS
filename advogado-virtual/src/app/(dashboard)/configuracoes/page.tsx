import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Building2, User, Shield, CreditCard, Users, ChevronLeft, Briefcase, CheckCircle, AlertTriangle, Info } from 'lucide-react'
import { formatarData } from '@/lib/utils'
import { isEncryptionConfigured } from '@/lib/encryption'
import { LABELS_ROLE } from '@/types'
import { FormPerfilProfissional } from '@/components/configuracoes/FormPerfilProfissional'
import { ConfigMovimentacoes } from '@/components/configuracoes/ConfigMovimentacoes'
import { PainelConsumoIA } from '@/components/configuracoes/PainelConsumoIA'
import { PadroesDocumentos } from '@/components/configuracoes/PadroesDocumentos'
import { FormatacaoEscritorio } from '@/components/configuracoes/FormatacaoEscritorio'
import { PapelTimbrado } from '@/components/configuracoes/PapelTimbrado'
import { ConfiguracoesTabs } from '@/components/configuracoes/ConfiguracoesTabs'

export const metadata = { title: 'Configurações' }
export const dynamic = 'force-dynamic'

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

  // Identificação do build e status de criptografia (úteis para confirmar o deploy)
  const buildSha  = process.env.NEXT_PUBLIC_BUILD_SHA  ?? 'local'
  const buildEnv  = process.env.NEXT_PUBLIC_BUILD_ENV  ?? 'development'
  const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME
  const criptoAtiva = isEncryptionConfigured()

  const tenant = usuario.tenants as {
    nome?: string; cnpj?: string; plano?: string; status?: string; created_at?: string
    oab_numero?: string; oab_estado?: string; cpf_responsavel?: string; rg_responsavel?: string
    orgao_expedidor?: string; estado_civil?: string; nacionalidade?: string; nome_responsavel?: string
    telefone?: string; email_profissional?: string; endereco?: string; bairro?: string
    cidade?: string; estado?: string; cep?: string
  } | null

  const conteudoConfiguracoes = (
    <>
      {/* Escritório */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
            Escritório
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
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
        <CardContent className="pt-0">
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

      {/* Dados profissionais do escritório — admin ou advogado responsável */}
      {['admin', 'advogado'].includes(usuario.role) && (
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

      {/* Avisos de movimentação — admin/advogado (Fase 5) */}
      {['admin', 'advogado'].includes(usuario.role) && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-muted-foreground" />
            Avisos de Movimentação ao Cliente
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ConfigMovimentacoes />
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
        <CardContent className="space-y-2.5 pt-0">
          <ItemSeguranca>Dados transmitidos com criptografia TLS</ItemSeguranca>
          <ItemSeguranca estado={criptoAtiva ? 'ok' : 'alerta'}>
            {criptoAtiva
              ? 'Dados sensíveis (CPF, RG e transcrições) guardados com criptografia forte'
              : 'Criptografia de dados sensíveis inativa neste ambiente — contate o suporte antes de cadastrar clientes reais'}
          </ItemSeguranca>
          <ItemSeguranca>Isolamento total entre escritórios (Row Level Security)</ItemSeguranca>
          <ItemSeguranca>Chave de IA nunca exposta ao navegador</ItemSeguranca>
          <ItemSeguranca estado="info">Em conformidade com a LGPD (Lei 13.709/2018)</ItemSeguranca>
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
        <CardContent className="pt-0">
          <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-4">
            <div>
              <p className="text-base font-semibold text-foreground">
                {LABELS_PLANO[tenant?.plano ?? 'trial'] ?? tenant?.plano}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {tenant?.plano && tenant.plano !== 'trial'
                  ? 'Plano ativo, com todas as funcionalidades liberadas.'
                  : 'Período de testes — todas as funcionalidades liberadas. Planos pagos estarão disponíveis em breve.'}
              </p>
            </div>
            <Badge variant={tenant?.status === 'ativo' ? 'success' : 'warning'}>
              {tenant?.status === 'ativo' ? 'Ativo' : (tenant?.status ?? '—')}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Rodapé discreto — identificação da versão (útil para o suporte técnico).
          Antes era um card "Versão do Sistema" com jargão de dev (commit, ambiente). */}
      <p className="pt-2 text-center text-xs text-muted-foreground/60">
        SIMAS · versão <span className="font-mono">{buildSha}</span>
        {buildEnv !== 'production' && ` · ${buildEnv}`}
        {buildTime && ` · ${new Date(buildTime).toLocaleDateString('pt-BR')}`}
      </p>
    </>
  )

  const conteudoConsumo = <PainelConsumoIA />
  const conteudoPadroes = (
    <>
      {usuario.role === 'admin' && <FormatacaoEscritorio />}
      {usuario.role === 'admin' && <PapelTimbrado />}
      <PadroesDocumentos />
    </>
  )

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
        <div className="mx-auto max-w-3xl">
          <ConfiguracoesTabs
            configuracoes={conteudoConfiguracoes}
            consumo={conteudoConsumo}
            padroes={conteudoPadroes}
          />
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
    <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2.5 last:border-0">
      <p className="shrink-0 text-sm text-muted-foreground">{label}</p>
      <div className="text-right text-sm font-medium text-foreground">{valor}</div>
    </div>
  )
}

function ItemSeguranca({
  estado = 'ok',
  children,
}: {
  estado?: 'ok' | 'alerta' | 'info'
  children: React.ReactNode
}) {
  const Icon = estado === 'ok' ? CheckCircle : estado === 'alerta' ? AlertTriangle : Info
  const cor = estado === 'ok' ? 'text-success' : estado === 'alerta' ? 'text-warning' : 'text-info'
  return (
    <p className="flex items-start gap-2.5 text-sm text-muted-foreground">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${cor}`} />
      <span>{children}</span>
    </p>
  )
}
