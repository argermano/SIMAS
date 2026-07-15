import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import { LABELS_AREA, LABELS_STATUS_ATENDIMENTO } from '@/types'
import { TIPOS_PECA } from '@/lib/constants/tipos-peca'
import { formatarData, formatarDataHora, formatarCPF, formatarTelefone } from '@/lib/utils'
import { decryptClienteFields, decryptTranscricaoFields } from '@/lib/encryption'
import { BotaoImprimir } from './BotaoImprimir'

export const metadata = { title: 'Ficha do atendimento' }
export const dynamic = 'force-dynamic'

// CSS de impressão: isola a ficha (esconde sidebar/chrome do dashboard) e a
// devolve ao fluxo para paginar. Mantido no próprio arquivo (leve, sem tocar
// no global). `.ficha-no-print` some na impressão; posicionamento absoluto em
// left/top:0 escapa do overflow-hidden do layout sem deixar a margem do menu.
const PRINT_CSS = `
@media print {
  .h-screen { height: auto !important; }
  .overflow-hidden { overflow: visible !important; }
  body * { visibility: hidden !important; }
  #ficha-print, #ficha-print * { visibility: visible !important; }
  #ficha-print {
    position: absolute !important;
    left: 0; top: 0; width: 100%;
    overflow: visible !important;
    padding: 0 !important;
  }
  .ficha-no-print { display: none !important; }
}
`

const label = (dic: Record<string, string>, k: string | null | undefined) =>
  (k && dic[k]) || k || '—'

export default async function FichaPage({
  params,
}: {
  params: Promise<{ id: string; atendimentoId: string }>
}) {
  const { id, atendimentoId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: usuario } = await supabase
    .from('users')
    .select('nome, tenant_id')
    .eq('auth_user_id', user.id)
    .single()
  if (!usuario) redirect('/login')

  // Valida tenant/permissão do mesmo jeito da página do caso (tenant + cliente + soft-delete).
  const { data: at } = await supabase
    .from('atendimentos')
    .select('id, titulo, area, estagio, status, created_at, encerrado_em, numero_processo, etiquetas, transcricao_raw, transcricao_editada, clientes(nome, cpf, telefone, email), pecas(id, tipo, versao, created_at), documentos(id, file_name, created_at)')
    .eq('id', atendimentoId)
    .eq('cliente_id', id)
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .single()
  if (!at) notFound()

  const [{ data: tenant }, { data: registrosRaw }] = await Promise.all([
    supabase
      .from('tenants')
      .select('nome, nome_responsavel, oab_numero, oab_estado, telefone, email_profissional, endereco, bairro, cidade, estado, cep')
      .eq('id', usuario.tenant_id)
      .single(),
    supabase
      .from('atendimento_registros')
      .select('id, texto, created_at, users(nome)')
      .eq('atendimento_id', atendimentoId)
      .eq('tenant_id', usuario.tenant_id)
      .order('created_at', { ascending: true }),
  ])

  // CPF/RG ficam cifrados em repouso — decifra igual à página do cliente antes de exibir.
  const clienteRaw = at.clientes as unknown as { nome: string; cpf: string | null; telefone: string | null; email: string | null } | null
  const cliente = clienteRaw ? (decryptClienteFields(clienteRaw as Record<string, unknown>) as unknown as typeof clienteRaw) : null
  const pecas = (at.pecas ?? []) as Array<{ id: string; tipo: string; versao: number; created_at: string }>
  const documentos = (at.documentos ?? []) as Array<{ id: string; file_name: string; created_at: string }>
  const etiquetas = (at.etiquetas ?? []) as string[]
  const registros = ((registrosRaw ?? []) as Array<{ id: string; texto: string; created_at: string; users: { nome: string | null } | { nome: string | null }[] | null }>).map((r) => {
    const u = Array.isArray(r.users) ? r.users[0] : r.users
    return { id: r.id, texto: r.texto, created_at: r.created_at, autor: u?.nome ?? '—' }
  })
  // Relato inicial (transcrição do áudio/texto) — cifrado em repouso, decifra igual à página do caso.
  const atDec = decryptTranscricaoFields(at as unknown as Record<string, unknown>)
  const relatoInicial =
    ((atDec.transcricao_editada as string | null)?.trim() || (atDec.transcricao_raw as string | null)?.trim()) || null

  const estagioLabel = at.estagio === 'atendimento' ? 'Atendimento' : 'Caso'
  const enderecoLinha = [tenant?.endereco, tenant?.bairro, [tenant?.cidade, tenant?.estado].filter(Boolean).join('/'), tenant?.cep]
    .filter(Boolean).join(' · ')
  const oabLinha = tenant?.oab_numero ? `OAB ${tenant.oab_numero}${tenant.oab_estado ? `/${tenant.oab_estado}` : ''}` : null

  const Rotulo = ({ children }: { children: React.ReactNode }) => (
    <span className="inline-block w-32 shrink-0 font-semibold text-black/60">{children}</span>
  )
  const Secao = ({ titulo, children }: { titulo: string; children: React.ReactNode }) => (
    <section className="mt-6 break-inside-avoid">
      <h2 className="mb-2 border-b border-black/30 pb-1 text-sm font-bold uppercase tracking-wide text-black">{titulo}</h2>
      {children}
    </section>
  )

  return (
    <div
      id="ficha-print"
      className="fixed inset-0 z-[60] overflow-y-auto bg-white p-8 text-[13px] leading-relaxed text-black"
      style={{ fontFamily: "'Georgia', 'Times New Roman', serif" }}
    >
      <style>{PRINT_CSS}</style>

      <div className="mx-auto max-w-3xl">
        {/* Barra de ações — some na impressão */}
        <div className="ficha-no-print mb-6 flex items-center justify-between">
          <a href={`/clientes/${id}/casos/${atendimentoId}`} className="text-sm font-medium text-black/60 hover:text-black">
            ← Voltar ao caso
          </a>
          <BotaoImprimir />
        </div>

        {/* Cabeçalho: escritório */}
        <header className="border-b-2 border-black pb-3">
          <h1 className="text-lg font-bold text-black">{tenant?.nome ?? 'Escritório'}</h1>
          {(tenant?.nome_responsavel || oabLinha) && (
            <p className="text-xs text-black/70">
              {[tenant?.nome_responsavel, oabLinha].filter(Boolean).join(' · ')}
            </p>
          )}
          {(tenant?.telefone || tenant?.email_profissional) && (
            <p className="text-xs text-black/70">{[tenant?.telefone, tenant?.email_profissional].filter(Boolean).join(' · ')}</p>
          )}
          {enderecoLinha && <p className="text-xs text-black/70">{enderecoLinha}</p>}
        </header>

        <h1 className="mt-5 text-center text-base font-bold uppercase tracking-wide text-black">
          Ficha do {estagioLabel}
        </h1>
        {at.titulo && <p className="mt-1 text-center text-sm text-black/80">{at.titulo}</p>}

        {/* Cliente */}
        <Secao titulo="Cliente">
          <div className="space-y-0.5">
            <p><Rotulo>Nome</Rotulo>{cliente?.nome ?? '—'}</p>
            <p><Rotulo>CPF</Rotulo>{cliente?.cpf ? formatarCPF(cliente.cpf) : '—'}</p>
            <p><Rotulo>Telefone</Rotulo>{cliente?.telefone ? formatarTelefone(cliente.telefone) : '—'}</p>
            {cliente?.email && <p><Rotulo>E-mail</Rotulo>{cliente.email}</p>}
          </div>
        </Secao>

        {/* Atendimento */}
        <Secao titulo="Atendimento">
          <div className="space-y-0.5">
            <p><Rotulo>Estágio</Rotulo>{estagioLabel}</p>
            <p><Rotulo>Área</Rotulo>{label(LABELS_AREA, at.area)}</p>
            <p><Rotulo>Situação</Rotulo>{label(LABELS_STATUS_ATENDIMENTO, at.status)}</p>
            <p><Rotulo>Aberto em</Rotulo>{formatarDataHora(at.created_at)}</p>
            {at.encerrado_em && <p><Rotulo>Encerrado em</Rotulo>{formatarDataHora(at.encerrado_em)}</p>}
            {at.numero_processo && <p><Rotulo>Processo nº</Rotulo>{at.numero_processo}</p>}
            {etiquetas.length > 0 && <p><Rotulo>Etiquetas</Rotulo>{etiquetas.join(', ')}</p>}
          </div>
        </Secao>

        {/* Diário — relato inicial (transcrição) abre a lista, depois os registros */}
        <Secao titulo="Diário do atendimento">
          {relatoInicial || registros.length > 0 ? (
            <ol className="space-y-3">
              {relatoInicial && (
                <li className="break-inside-avoid border-l-2 border-black/30 pl-3">
                  <p className="text-xs font-semibold text-black/60">{formatarDataHora(at.created_at)} · Relato inicial</p>
                  <p className="whitespace-pre-wrap text-black">{relatoInicial}</p>
                </li>
              )}
              {registros.map((r) => (
                <li key={r.id} className="break-inside-avoid border-l-2 border-black/20 pl-3">
                  <p className="text-xs font-semibold text-black/60">{formatarDataHora(r.created_at)} · {r.autor}</p>
                  <p className="whitespace-pre-wrap text-black">{r.texto}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-black/50">Nenhum registro no diário.</p>
          )}
        </Secao>

        {/* Documentos */}
        <Secao titulo="Documentos">
          {documentos.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-5">
              {documentos.map((d) => (
                <li key={d.id}>{d.file_name} <span className="text-xs text-black/50">({formatarData(d.created_at)})</span></li>
              ))}
            </ul>
          ) : (
            <p className="text-black/50">Nenhum documento anexado.</p>
          )}
        </Secao>

        {/* Peças */}
        <Secao titulo="Peças">
          {pecas.length > 0 ? (
            <ul className="list-disc space-y-0.5 pl-5">
              {pecas.map((p) => (
                <li key={p.id}>{TIPOS_PECA[p.tipo]?.nome ?? p.tipo} <span className="text-xs text-black/50">(v{p.versao})</span></li>
              ))}
            </ul>
          ) : (
            <p className="text-black/50">Nenhuma peça gerada.</p>
          )}
        </Secao>

        {/* Carimbo de emissão — deve sair TAMBÉM no papel/PDF (documento arquivável). */}
        <p className="mt-8 text-center text-xs text-black/40">
          Emitido em {formatarDataHora(new Date().toISOString())}
        </p>
      </div>
    </div>
  )
}
