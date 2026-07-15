import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { preencherTemplateDocx, MAX_MODELO_BYTES } from '@/lib/export/preencher-template-docx'
import { montarPlaceholders } from '@/lib/export/montar-placeholders'
import { TIPO_MODELO_DOCX, NOME_AMIGAVEL_DOC } from '@/lib/export/tipos-modelo-docx'
import { extrairTextoDocx } from '@/lib/modelos/templatizar-docx'
import { extrairPlaceholders, PLACEHOLDERS_PADRAO_POR_TIPO } from '@/lib/documentos/campos-cliente'
import { decryptClienteFields } from '@/lib/encryption'

// Tipo de geração → tipo do modelo em `modelos_documento` na variante MARKDOWN (fluxo IA).
// Espelha TIPO_MODELO_DOC de /api/ia/gerar-documento (notificação não tem modelo).
const TIPO_MODELO_MARKDOWN: Record<string, string | null> = {
  procuracao: 'procuracao',
  declaracao_hipossuficiencia: 'declaracao',
  substabelecimento: 'substabelecimento',
  contrato_honorarios: 'contrato',
  notificacao_extrajudicial: null,
}

// GET /api/documentos/exportar-modelo?tipo=procuracao
// Retorna { existe } (há modelo .docx cadastrado?) E { placeholders } — os {{campos}}
// USADOS pelo template ATIVO daquele tipo. A tela usa `placeholders` para saber, via
// camposFaltantes, quais dados do cliente pedir ao atendente ANTES de gerar.
export async function GET(req: NextRequest) {
  const tipo = req.nextUrl.searchParams.get('tipo') ?? ''
  if (!tipo) return NextResponse.json({ existe: false, placeholders: [] })

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const tipoModeloDocx = TIPO_MODELO_DOCX[tipo]
  const tipoModeloMd = TIPO_MODELO_MARKDOWN[tipo]

  let existe = false
  let placeholders: string[] = []

  // 1) Fonte primária: modelo .docx do escritório (só para tipos que o suportam).
  if (tipoModeloDocx) {
    const { data: modelo } = await supabase
      .from('modelos_documento')
      .select('file_url')
      .eq('tenant_id', usuario.tenant_id)
      .eq('tipo', tipoModeloDocx)
      .not('file_url', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    existe = !!modelo?.file_url && /\.docx$/i.test(modelo.file_url)
    if (existe) {
      try {
        const { data: arquivo } = await supabase.storage.from('documentos').download(modelo!.file_url)
        if (arquivo && arquivo.size <= MAX_MODELO_BYTES) {
          const buf = Buffer.from(await arquivo.arrayBuffer())
          placeholders = extrairPlaceholders(extrairTextoDocx(buf))
        }
      } catch { /* baixa/parse falhou → cai no fallback abaixo */ }
    }
  }

  // 2) Sem .docx utilizável: modelo markdown do escritório (fluxo IA preenche o modelo).
  if (placeholders.length === 0 && tipoModeloMd) {
    const { data: md } = await supabase
      .from('modelos_documento')
      .select('conteudo_markdown')
      .eq('tenant_id', usuario.tenant_id)
      .eq('tipo', tipoModeloMd)
      .not('conteudo_markdown', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (md?.conteudo_markdown?.trim()) placeholders = extrairPlaceholders(md.conteudo_markdown)
  }

  // 3) Template gerado por IA e cacheado para este tipo.
  if (placeholders.length === 0) {
    const { data: tpl } = await supabase
      .from('templates_documentos')
      .select('conteudo_markdown')
      .eq('tenant_id', usuario.tenant_id)
      .eq('tipo', tipo)
      .maybeSingle()
    if (tpl?.conteudo_markdown?.trim()) placeholders = extrairPlaceholders(tpl.conteudo_markdown)
  }

  // 4) Nenhum modelo: conjunto padrão por tipo (o que o fluxo IA de fato substitui).
  if (placeholders.length === 0) {
    placeholders = PLACEHOLDERS_PADRAO_POR_TIPO[tipo] ?? PLACEHOLDERS_PADRAO_POR_TIPO._default
  }

  return NextResponse.json({ existe, placeholders })
}

// POST /api/documentos/exportar-modelo
// body: { tipo, clienteId, camposExtras? }
// Preenche o TEMPLATE .docx do escritório (com {{placeholders}}) com os dados do cliente +
// escritório — fidelidade 1:1 ao layout do modelo. Documentos efêmeros (sem id próprio):
// os dados vêm do clienteId + camposExtras, exatamente como na geração.
export async function POST(req: NextRequest) {
  const { tipo, clienteId, camposExtras } = (await req.json().catch(() => ({}))) as {
    tipo?: string
    clienteId?: string
    camposExtras?: Record<string, string>
  }

  if (!tipo || !clienteId) return jsonError('tipo e clienteId são obrigatórios', 400)

  const tipoModelo = TIPO_MODELO_DOCX[tipo]
  if (!tipoModelo) return jsonError('Este tipo de documento não suporta modelo .docx', 400)

  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const semPermissao = requireRole(usuario, ['admin', 'advogado'])
  if (semPermissao) return semPermissao

  // Cliente (campos completos) + escritório
  const { data: clienteRaw } = await supabase
    .from('clientes')
    .select('nome, cpf, rg, orgao_expedidor, estado_civil, nacionalidade, profissao, telefone, email, endereco, bairro, cidade, estado, cep')
    .eq('id', clienteId)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!clienteRaw) return jsonError('Cliente não encontrado', 404)

  const { data: tenant } = await supabase
    .from('tenants')
    .select('nome, cnpj, nome_responsavel, oab_numero, oab_estado, cpf_responsavel, rg_responsavel, orgao_expedidor, estado_civil, nacionalidade, telefone, email_profissional, endereco, bairro, cidade, estado, cep')
    .eq('id', usuario.tenant_id)
    .single()

  // Modelo .docx mais recente para o tipo
  const { data: modelo } = await supabase
    .from('modelos_documento')
    .select('file_url')
    .eq('tenant_id', usuario.tenant_id)
    .eq('tipo', tipoModelo)
    .not('file_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!modelo?.file_url || !/\.docx$/i.test(modelo.file_url)) {
    const nome = NOME_AMIGAVEL_DOC[tipo] ?? 'documento'
    return jsonError(`Nenhum modelo de ${nome} em .docx cadastrado. Cadastre em Configurações → Padrões (com placeholders {{campo}}).`, 400)
  }

  const { data: arquivo, error: dlErr } = await supabase.storage.from('documentos').download(modelo.file_url)
  if (dlErr || !arquivo) return jsonError('Falha ao baixar o modelo do storage', 500)
  if (arquivo.size > MAX_MODELO_BYTES) return jsonError('Modelo .docx muito grande para processar', 413)
  const templateBuffer = Buffer.from(await arquivo.arrayBuffer())

  // Fonte única de placeholders (decifra CPF/RG); camposExtras = objeto, renda_mensal, etc.
  const cliente = decryptClienteFields(clienteRaw as unknown as Record<string, unknown>)
  const dados = montarPlaceholders({ tenant, cliente, extras: camposExtras })

  let buffer: Buffer
  try {
    buffer = preencherTemplateDocx(templateBuffer, dados)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao preencher o modelo'
    return jsonError(`Erro no modelo: ${msg}. Verifique os placeholders {{campo}} no .docx.`, 422)
  }

  const nome = (NOME_AMIGAVEL_DOC[tipo] ?? 'documento').replace(/[^a-zA-Z0-9]/g, '') || 'documento'
  const cliNome = String((cliente as Record<string, unknown>)?.nome ?? '').replace(/[^a-zA-Z0-9\s_-]/g, '').trim().replace(/\s+/g, '_')
  const fileName = cliNome ? `${nome}_${cliNome}` : nome

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fileName}.docx"`,
    },
  })
}
