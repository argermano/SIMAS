import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getAuthContext, requireRole } from '@/lib/auth'
import { jsonError, validateBody } from '@/lib/api'
import { rowParaEstilo, DEFAULT_ABNT } from '@/lib/format/estilo-documento'

const schema = z.object({
  fonte:                   z.string().min(1).max(80),
  tamanho_pt:              z.number().min(8).max(18),
  tamanho_ementa_pt:       z.number().min(7).max(16),
  entrelinha:              z.number().min(1).max(2.5),
  recuo_primeira_linha_cm: z.number().min(0).max(5),
  recuo_blockquote_cm:     z.number().min(0).max(8),
  margem_topo_cm:          z.number().min(0).max(8),
  margem_baixo_cm:         z.number().min(0).max(8),
  margem_esquerda_cm:      z.number().min(0).max(8),
  margem_direita_cm:       z.number().min(0).max(8),
  cabecalho:               z.string().max(300).optional().nullable(),
  rodape:                  z.string().max(300).optional().nullable(),
  numerar_paginas:         z.boolean().optional(),
})

// GET — estilo atual do escritório (ou default ABNT)
export async function GET() {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const { data } = await supabase
    .from('padroes_documento')
    .select('*')
    .eq('tenant_id', usuario.tenant_id)
    .maybeSingle()

  return NextResponse.json({ padrao: data, estilo: rowParaEstilo(data), default: DEFAULT_ABNT })
}

// PUT — salva o estilo do escritório (somente admin)
export async function PUT(req: NextRequest) {
  const auth = await getAuthContext()
  if (!auth.ok) return auth.response
  const { supabase, usuario } = auth

  const semPermissao = requireRole(usuario, ['admin'])
  if (semPermissao) return semPermissao

  const parsed = await validateBody(req, schema)
  if (!parsed.ok) return parsed.response

  const { error } = await supabase
    .from('padroes_documento')
    .upsert({ tenant_id: usuario.tenant_id, ...parsed.data }, { onConflict: 'tenant_id' })

  if (error) return jsonError(error.message, 500)
  return NextResponse.json({ ok: true })
}
