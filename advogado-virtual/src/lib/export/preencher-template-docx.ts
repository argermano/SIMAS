import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'

// Limite defensivo: o template é carregado inteiro em memória antes de preencher.
// O upload de modelos já limita a 10 MB; este teto evita OOM caso algo maior chegue.
export const MAX_MODELO_BYTES = 20 * 1024 * 1024

/**
 * Preenche um TEMPLATE .docx (com placeholders {{campo}}) com os dados informados,
 * preservando 100% da formatação real do arquivo (fonte, margens, cabeçalho/rodapé,
 * logo, layout). Fidelidade 1:1 ao modelo do escritório.
 *
 * O advogado prepara um .docx contendo placeholders no formato {{nome_cliente}}.
 */
export function preencherTemplateDocx(
  templateBuffer: Buffer,
  dados: Record<string, unknown>,
): Buffer {
  const zip = new PizZip(templateBuffer)
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    // Placeholder sem valor → string vazia (em vez de lançar/"undefined")
    nullGetter: () => '',
  })

  doc.render(dados)

  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}
