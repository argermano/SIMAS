import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { pertenceAoTenant } from '@/lib/ownership'
import { logAudit } from '@/lib/audit'
import { logger } from '@/lib/logger'
import { etiquetasField, schemaVinculoAtendimento, vinculoAtendimentoParaColunas } from '@/lib/atendimentos'
import { vinculoValido } from '@/lib/tarefas/validar-vinculo'

// Embed to-one pode vir como objeto ou array — normaliza para o 1º.
// Devolve o cru relevante (status_cadastro/telefone alimentam campos derivados).
function umCliente(
  rel: unknown,
): { id: string; nome: string; status_cadastro?: string; telefone: string | null } | null {
  const r = Array.isArray(rel) ? rel[0] : rel
  const c = r as { id?: string; nome?: string; status_cadastro?: string; telefone?: string | null } | null
  return c?.id
    ? { id: c.id, nome: (c.nome ?? '').trim(), status_cadastro: c.status_cadastro, telefone: c.telefone ?? null }
    : null
}

// Embed to-one do responsável (users). Avatar = inicial do nome no cliente.
function umUsuario(rel: unknown): { id: string; nome: string } | null {
  const r = Array.isArray(rel) ? rel[0] : rel
  const u = r as { id?: string; nome?: string } | null
  return u?.id ? { id: u.id, nome: (u.nome ?? '').trim() } : null
}

// Soma os valores fixos dos contratos do atendimento (embed to-many).
// valor_fixo é DECIMAL(12,2) → REAIS (não centavos); devolvemos em reais, como o
// resto do app formata (contratos/page.tsx, clientes). Sem valor fixo → null.
function somaHonorarios(rel: unknown): number | null {
  const arr = Array.isArray(rel) ? rel : rel ? [rel] : []
  let soma = 0
  let houve = false
  for (const c of arr) {
    const v = (c as { valor_fixo?: number | string | null })?.valor_fixo
    if (v != null) {
      soma += Number(v)
      houve = true
    }
  }
  return houve ? soma : null
}

// Sanitiza o termo para uso dentro de .or() do PostgREST (vírgula/parênteses
// quebram a gramática do filtro).
function termoOr(q: string): string {
  return q.replace(/[,()]/g, ' ')
}

// GET /api/atendimentos
//   ?cliente_id=UUID           → lista por cliente (comportamento legado)
//   (sem cliente_id)           → lista GLOBAL do tenant com filtros e paginação:
//     ?status=andamento|encerrados  (andamento = status != 'finalizado')
//     ?estagio=atendimento|caso
//     ?q=  (busca em titulo e no nome do cliente)
//     ?page=
export async function GET(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const sp = new URL(req.url).searchParams
  const clienteId = sp.get('cliente_id')

  // ── Legado: lista enxuta por cliente (usada pelo form de contrato) ──────────
  if (clienteId) {
    const { data } = await supabase
      .from('atendimentos')
      .select('id, area, tipo_peca_origem, status, created_at')
      .eq('cliente_id', clienteId)
      .eq('tenant_id', usuario.tenant_id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })

    return NextResponse.json({ atendimentos: data ?? [] })
  }

  // ── Lista global com filtros + paginação ────────────────────────────────────
  const status  = sp.get('status')   // andamento | encerrados
  const estagio = sp.get('estagio')   // atendimento | caso
  const q       = (sp.get('q') ?? '').trim()
  const page    = Math.max(1, parseInt(sp.get('page') ?? '1') || 1)
  const limit   = 20
  const offset  = (page - 1) * limit

  let query = supabase
    .from('atendimentos')
    // numero (058) + embeds to-one (cliente/responsável) e to-many (contratos):
    // tudo numa query só. proximoPasso vem em UM query em lote separado (abaixo).
    // String única (literal) — concatenar quebraria a inferência do PostgREST.
    .select('id, numero, titulo, area, estagio, status, etiquetas, created_at, encerrado_em, clientes:cliente_id ( id, nome, status_cadastro, telefone ), responsavel:user_id ( id, nome ), contratos_honorarios ( valor_fixo )', { count: 'exact' })
    .eq('tenant_id', usuario.tenant_id)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })

  if (status === 'andamento')  query = query.neq('status', 'finalizado')
  if (status === 'encerrados') query = query.eq('status', 'finalizado')
  if (estagio === 'atendimento' || estagio === 'caso') query = query.eq('estagio', estagio)

  if (q.length >= 2) {
    // Busca no titulo (coluna própria) OU pelo nome do CLIENTE OU do RESPONSÁVEL
    // (relações): resolve os ids que batem em cada tabela e filtra por *_id.in —
    // tudo num único .or(). As duas resoluções vão em paralelo (sem round-trip
    // extra). users não tem deleted_at; RLS já restringe ao tenant (005).
    const ors = [`titulo.ilike.%${termoOr(q)}%`]
    const [{ data: cs }, { data: us }] = await Promise.all([
      supabase
        .from('clientes')
        .select('id')
        .eq('tenant_id', usuario.tenant_id)
        .is('deleted_at', null)
        .ilike('nome', `%${q}%`)
        .limit(50),
      supabase
        .from('users')
        .select('id')
        .eq('tenant_id', usuario.tenant_id)
        .ilike('nome', `%${q}%`)
        .limit(50),
    ])
    const ids  = (cs ?? []).map((c) => c.id as string)
    const uids = (us ?? []).map((u) => u.id as string)
    if (ids.length)  ors.push(`cliente_id.in.(${ids.join(',')})`)
    if (uids.length) ors.push(`user_id.in.(${uids.join(',')})`)
    query = query.or(ors.join(','))
  }

  const { data, count, error } = await query.range(offset, offset + limit - 1)
  if (error) return jsonError(error.message, 500)

  // ── PRÓXIMO PASSO: a próxima tarefa ABERTA de cada atendimento da página ─────
  // Um único query em lote pelos ids da página. Ordem global (menor due_date
  // primeiro, nulos por último, empate = mais antiga); o 1º visto por process_id
  // é a "próxima" (dedupe abaixo). Bolinha/cor fica a cargo da UI (usa dueDate).
  const idsPagina = (data ?? []).map((a) => a.id as string)
  const proximoPasso = new Map<string, { descricao: string; dueDate: string | null }>()
  if (idsPagina.length) {
    const { data: tarefas } = await supabase
      .from('tasks')
      .select('process_id, description, due_date')
      .eq('tenant_id', usuario.tenant_id)
      .is('completed_at', null)
      .in('process_id', idsPagina)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: true })
    for (const t of tarefas ?? []) {
      const pid = t.process_id as string | null
      if (!pid || proximoPasso.has(pid)) continue // 1ª na ordem = a próxima
      proximoPasso.set(pid, { descricao: (t.description as string) ?? '', dueDate: (t.due_date as string | null) ?? null })
    }
  }

  const atendimentos = (data ?? []).map((a) => {
    const cli = umCliente((a as { clientes?: unknown }).clientes)
    return {
      id:                    a.id,
      numero:                a.numero,
      titulo:                a.titulo,
      area:                  a.area,
      estagio:               a.estagio,
      status:                a.status,
      etiquetas:             a.etiquetas ?? [],
      created_at:            a.created_at,
      encerrado_em:          a.encerrado_em,
      cliente:               cli ? { id: cli.id, nome: cli.nome, pre_cadastro: cli.status_cadastro === 'pre_cadastro' } : null,
      telefoneCliente:       cli?.telefone ?? null,
      statusCadastroCliente: cli?.status_cadastro ?? null,
      responsavel:           umUsuario((a as { responsavel?: unknown }).responsavel),
      honorariosValor:       somaHonorarios((a as { contratos_honorarios?: unknown }).contratos_honorarios),
      proximoPasso:          proximoPasso.get(a.id as string) ?? null,
    }
  })

  return NextResponse.json({
    atendimentos,
    total:        count ?? 0,
    pagina:       page,
    totalPaginas: Math.ceil((count ?? 0) / limit),
  })
}

const schemaNovoAtendimento = z
  .object({
    // cliente_id OU cliente_nome (mutuamente exclusivos — ver refine).
    cliente_id:       z.string().uuid().optional(),
    cliente_nome:     z.string().trim().min(2).max(200).optional(),
    area:             z.string().min(1),
    tipo_peca_origem: z.string().nullable().optional(),
    tipo_servico:     z.enum(['administrativo', 'judicial']).nullable().optional(),
    tipo_processo:    z.string().nullable().optional(),
    modo_input:       z.enum(['audio', 'texto']).default('texto'),
    // Primeiro atendimento (056): organização leve + nascimento pré-peça + 1º registro.
    titulo:           z.string().trim().max(200).optional(),
    etiquetas:        etiquetasField.optional(),
    estagio:          z.enum(['atendimento', 'caso']).optional(), // omitido = default 'caso' do banco
    primeiro_registro: z.string().trim().min(1).max(8000).optional(),
    // Vínculo opcional com outro caso/atendimento ou processo (057).
    vinculo:          schemaVinculoAtendimento.optional(),
  })
  .refine((d) => (d.cliente_id ? 1 : 0) + (d.cliente_nome ? 1 : 0) === 1, {
    message: 'Informe cliente_id OU cliente_nome (exatamente um)',
    path: ['cliente_id'],
  })

// POST /api/atendimentos — cria novo atendimento
export async function POST(req: Request) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const parsed = await validateBody(req, schemaNovoAtendimento)
  if (!parsed.ok) return parsed.response

  const dados = parsed.data

  // ── Resolve o cliente: id existente (checa tenant) OU cria pré-cadastro leve ──
  let clienteId: string
  if (dados.cliente_id) {
    // A8: o cliente referenciado precisa pertencer ao tenant do usuário.
    if (!(await pertenceAoTenant(supabase, 'clientes', dados.cliente_id, usuario.tenant_id))) {
      return jsonError('Cliente inválido', 400)
    }
    clienteId = dados.cliente_id
  } else {
    // Nascimento leve: só o nome. status_cadastro='pre_cadastro' o mantém fora do
    // cadastro/busca de clientes até ser detalhado (mesmo padrão do funil).
    const { data: novoCliente, error: errCli } = await supabase
      .from('clientes')
      .insert({
        nome:            dados.cliente_nome!,
        status_cadastro: 'pre_cadastro',
        tenant_id:       usuario.tenant_id,
        created_by:      usuario.id,
      })
      .select('id')
      .single()
    if (errCli || !novoCliente) return jsonError('Não foi possível criar o cliente', 500)
    clienteId = novoCliente.id
    await logAudit({
      tenantId: usuario.tenant_id,
      userId: usuario.id,
      action: 'cliente.pre_cadastro_criado',
      resourceType: 'cliente',
      resourceId: novoCliente.id,
      metadata: { via: 'atendimento' },
    })
  }

  // ── Valida o vínculo opcional (existência + tenant) antes de inserir ─────────
  // Auto-referência é impossível aqui: o atendimento ainda não existe (id novo).
  let colunasVinculo: ReturnType<typeof vinculoAtendimentoParaColunas> | null = null
  if (dados.vinculo) {
    if (!(await vinculoValido(supabase, dados.vinculo, usuario.tenant_id))) {
      return jsonError('Vínculo inválido', 400)
    }
    colunasVinculo = vinculoAtendimentoParaColunas(dados.vinculo)
  }

  // Monta o objeto de inserção sem incluir campos nulos de colunas opcionais
  // (evita erro de schema cache quando a migration ainda não foi aplicada)
  const inserir: Record<string, unknown> = {
    tenant_id:        usuario.tenant_id,
    cliente_id:       clienteId,
    user_id:          usuario.id,
    area:             dados.area,
    modo_input:       dados.modo_input,
    status:           'caso_novo',
  }
  if (dados.tipo_peca_origem) inserir.tipo_peca_origem = dados.tipo_peca_origem
  if (dados.tipo_servico)     inserir.tipo_servico     = dados.tipo_servico
  if (dados.tipo_processo)    inserir.tipo_processo    = dados.tipo_processo
  if (dados.titulo)                   inserir.titulo    = dados.titulo
  if (dados.etiquetas && dados.etiquetas.length) inserir.etiquetas = dados.etiquetas
  if (dados.estagio)                  inserir.estagio   = dados.estagio // senão, default 'caso' do banco
  if (colunasVinculo) Object.assign(inserir, colunasVinculo) // só a coluna do tipo escolhido

  const { data: atendimento, error } = await supabase
    .from('atendimentos')
    .insert(inserir)
    .select('id')
    .single()

  if (error) return jsonError(error.message, 500)

  // 1º registro do diário na mesma criação (nascimento leve). Contrato: "mesma
  // transação lógica" — se o registro falhar, desfazemos o atendimento recém-criado
  // (ainda sem dependências) e devolvemos erro, para a anotação obrigatória não
  // sumir em silêncio; o cliente reexibe o erro com o texto preservado. (LGPD: sem texto.)
  if (dados.primeiro_registro) {
    const { data: reg, error: errReg } = await supabase
      .from('atendimento_registros')
      .insert({
        tenant_id:      usuario.tenant_id,
        atendimento_id: atendimento.id,
        user_id:        usuario.id,
        texto:          dados.primeiro_registro,
      })
      .select('id')
      .single()
    if (errReg) {
      logger.error('atendimento.primeiro_registro_falhou', { atendimento_id: atendimento.id }, errReg)
      await supabase.from('atendimentos').delete().eq('id', atendimento.id).eq('tenant_id', usuario.tenant_id)
      // Se o pré-cadastro foi criado só para este atendimento (via cliente_nome),
      // desfaz também — senão fica um cliente órfão invisível (escondido da lista).
      if (!dados.cliente_id) {
        await supabase.from('clientes').delete().eq('id', clienteId).eq('tenant_id', usuario.tenant_id)
      }
      return jsonError('Não foi possível registrar a anotação inicial. Tente novamente.', 500)
    } else {
      await logAudit({
        tenantId: usuario.tenant_id,
        userId: usuario.id,
        action: 'atendimento.registro_criado',
        resourceType: 'atendimento',
        resourceId: atendimento.id,
        metadata: { registro_id: reg.id, primeiro: true },
      })
    }
  }

  // Devolve o cliente_id para o modal navegar ao caso mesmo quando o cliente
  // acabou de nascer via cliente_nome (pré-cadastro criado no servidor).
  return NextResponse.json({ id: atendimento.id, cliente_id: clienteId }, { status: 201 })
}
