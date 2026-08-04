import { baixarArquivo, extensaoDoMime, mensagemErroDownload, nomeDaUrlDeDownload } from '@/lib/download'

// Baixar comprovante é o MESMO gesto nos três lugares que o mostram (conferência
// do staging, detalhe do inbox e detalhe do pagamento): a signed URL já vem do
// servidor com `?download=nome.ext`, então o nome sugerido no seletor de pasta é
// exatamente o que o servidor escolheu. Aqui só centralizamos o clique.

/** Nome sugerido: o do servidor na própria signed URL; senão 'comprovante' com
 * a extensão do content-type (sem extensão o seletor abre sem filtro). */
export function nomeDoComprovante(downloadUrl: string, contentType?: string | null): string {
  return nomeDaUrlDeDownload(downloadUrl) ?? `comprovante${extensaoDoMime(contentType)}`
}

/**
 * Clique em "Baixar" do comprovante. Chromium: abre o seletor de pasta (por isso
 * o preventDefault). Safari/Firefox: cai no download clássico da mesma URL — o
 * `href` da âncora continua lá e nada muda. Cancelar o seletor é silêncio;
 * falha real chama `aoFalhar` para o toast honesto.
 */
export async function baixarComprovante(
  e: { preventDefault: () => void },
  downloadUrl: string,
  contentType: string | null | undefined,
  aoFalhar: (titulo: string, detalhe: string) => void,
): Promise<void> {
  e.preventDefault()
  try {
    await baixarArquivo({
      url: downloadUrl,
      filename: nomeDoComprovante(downloadUrl, contentType),
      mimetype: contentType,
    })
  } catch (erro) {
    aoFalhar('Não foi possível salvar o arquivo', mensagemErroDownload(erro))
  }
}
