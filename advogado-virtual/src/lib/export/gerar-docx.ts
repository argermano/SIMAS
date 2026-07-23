// Miolo compartilhado da exportação DOCX: markdown → .docx + papel timbrado do
// escritório (se houver). Extraído de /api/exportar-documento, /api/exportar e
// /api/atendimentos/[id]/documentos/anexar-gerado, que repetiam este bloco. Deixa
// o CHAMADOR resolver o `estilo` (carregarEstiloTenant OU resolverEstiloEfetivo),
// pois cada fluxo escolhe o seu. Falha no timbrado NUNCA bloqueia — a peça sai sem
// o papel timbrado. SERVER-ONLY (usa Buffer + Storage).

import type { SupabaseClient } from '@supabase/supabase-js'
import { markdownToDocx } from './docx-generator'
import { aplicarTimbrado } from './aplicar-timbrado'
import type { EstiloDocumento } from '@/lib/format/estilo-documento'

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export interface GerarDocxOpts {
  conteudo: string
  titulo?: string
  area?: string
  /** Estilo já resolvido pelo chamador (escritório > default, ou efetivo do modelo). */
  estilo?: Partial<EstiloDocumento> | null
  compacto?: boolean
  contrato?: boolean
}

/**
 * Gera o .docx a partir do markdown e, se o escritório tiver papel timbrado
 * cadastrado, o aplica preservando cabeçalho/marca d'água/rodapé. Retorna o Buffer
 * pronto para download ou upload no Storage.
 */
export async function gerarDocxComTimbrado(
  supabase: SupabaseClient,
  tenantId: string,
  opts: GerarDocxOpts,
): Promise<Buffer> {
  let buffer = await markdownToDocx(opts.conteudo, {
    titulo: opts.titulo,
    area: opts.area,
    estilo: opts.estilo,
    compacto: opts.compacto,
    contrato: opts.contrato,
  })

  const { data: timbrado } = await supabase.storage
    .from('documentos')
    .download(`${tenantId}/timbrado/timbrado.docx`)
  if (timbrado) {
    try {
      buffer = aplicarTimbrado(Buffer.from(await timbrado.arrayBuffer()), buffer)
    } catch (err) {
      console.error(
        '[gerar-docx] falha ao aplicar timbrado:',
        err instanceof Error ? err.message : err,
      )
    }
  }
  return buffer
}
