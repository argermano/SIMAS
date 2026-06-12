import { NextRequest, NextResponse } from 'next/server'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError } from '@/lib/api'
import { preencherTemplateDocx, MAX_MODELO_BYTES } from '@/lib/export/preencher-template-docx'
import { montarPlaceholders } from '@/lib/export/montar-placeholders'
import { decryptClienteFields } from '@/lib/encryption'

// POST /api/contratos/[id]/exportar-modelo
// Preenche o TEMPLATE .docx do escritório (com {{placeholders}}) com os dados do
// contrato — fidelidade 1:1 ao layout do modelo. Requer um modelo de contrato .docx
// cadastrado (Configurações → Padrões) contendo placeholders {{campo}}.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const semPermissao = requireRole(usuario, ['admin', 'advogado'])
  if (semPermissao) return semPermissao

  // Contrato + cliente + dados profissionais do escritório
  const { data: contrato } = await supabase
    .from('contratos_honorarios')
    .select('id, titulo, valor_fixo, percentual_exito, forma_pagamento, area, clientes(nome, cpf, rg, orgao_expedidor, estado_civil, nacionalidade, profissao, telefone, email, endereco, bairro, cidade, estado, cep)')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!contrato) return jsonError('Contrato não encontrado', 404)

  const { data: tenant } = await supabase
    .from('tenants')
    .select('nome, cnpj, nome_responsavel, oab_numero, oab_estado, cpf_responsavel, rg_responsavel, orgao_expedidor, estado_civil, nacionalidade, telefone, email_profissional, endereco, bairro, cidade, estado, cep')
    .eq('id', usuario.tenant_id)
    .single()

  // Modelo de contrato em .docx (mais recente com arquivo)
  const { data: modelo } = await supabase
    .from('modelos_documento')
    .select('file_url')
    .eq('tenant_id', usuario.tenant_id)
    .eq('tipo', 'contrato')
    .not('file_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!modelo?.file_url || !/\.docx$/i.test(modelo.file_url)) {
    return jsonError('Nenhum modelo de contrato .docx cadastrado. Cadastre em Configurações → Padrões (com placeholders {{campo}}).', 400)
  }

  const { data: arquivo, error: dlErr } = await supabase.storage.from('documentos').download(modelo.file_url)
  if (dlErr || !arquivo) return jsonError('Falha ao baixar o modelo do storage', 500)
  if (arquivo.size > MAX_MODELO_BYTES) return jsonError('Modelo .docx muito grande para processar', 413)
  const templateBuffer = Buffer.from(await arquivo.arrayBuffer())

  // Decifra CPF/RG e monta os placeholders via a fonte única (o join pode vir como array)
  const clienteRow = Array.isArray(contrato.clientes) ? contrato.clientes[0] : contrato.clientes
  const cliente = decryptClienteFields((clienteRow ?? null) as unknown as Record<string, unknown> | null)
  const dados = montarPlaceholders({
    tenant,
    cliente,
    contrato: {
      titulo: contrato.titulo,
      area: contrato.area,
      valor_fixo: contrato.valor_fixo,
      percentual_exito: contrato.percentual_exito,
      forma_pagamento: contrato.forma_pagamento,
    },
  })

  let buffer: Buffer
  try {
    buffer = preencherTemplateDocx(templateBuffer, dados)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Erro ao preencher o modelo'
    return jsonError(`Erro no modelo: ${msg}. Verifique os placeholders {{campo}} no .docx.`, 422)
  }

  const fileName = (contrato.titulo ?? 'contrato').replace(/[^a-zA-Z0-9\s_-]/g, '').trim() || 'contrato'

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${fileName}_modelo.docx"`,
    },
  })
}
