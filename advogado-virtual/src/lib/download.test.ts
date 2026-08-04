import { describe, expect, it } from 'vitest'
import {
  ehCancelamento,
  extensaoDe,
  extensaoDoMime,
  nomeDaUrlDeDownload,
  nomeSeguro,
  suportaEscolhaDePasta,
  tiposDoPicker,
} from './download'

// Parte PURA do download com escolha de pasta: decisão de suporte, nome sugerido
// e montagem do filtro `types` do seletor. O resto (picker, fetch, gravação)
// depende do navegador e não é testável aqui.

describe('suportaEscolhaDePasta', () => {
  it('reconhece o Chromium (showSaveFilePicker é função)', () => {
    expect(suportaEscolhaDePasta({ showSaveFilePicker: () => Promise.resolve({}) })).toBe(true)
  })

  it('nega em Safari/Firefox (API ausente)', () => {
    expect(suportaEscolhaDePasta({})).toBe(false)
  })

  it('nega sem janela (SSR/Node) e com valor que não é função', () => {
    expect(suportaEscolhaDePasta(undefined)).toBe(false)
    expect(suportaEscolhaDePasta(null)).toBe(false)
    expect(suportaEscolhaDePasta({ showSaveFilePicker: true })).toBe(false)
  })
})

describe('ehCancelamento', () => {
  it('AbortError = usuário desistiu (não é erro)', () => {
    expect(ehCancelamento({ name: 'AbortError', message: 'The user aborted a request.' })).toBe(true)
  })

  it('qualquer outro erro não é cancelamento', () => {
    expect(ehCancelamento(new Error('disco cheio'))).toBe(false)
    expect(ehCancelamento({ name: 'NotAllowedError' })).toBe(false)
    expect(ehCancelamento(null)).toBe(false)
    expect(ehCancelamento(undefined)).toBe(false)
  })
})

describe('extensaoDe', () => {
  it('devolve a extensão minúscula com ponto', () => {
    expect(extensaoDe('Contrato.DOCX')).toBe('.docx')
    expect(extensaoDe('comprovante.pdf')).toBe('.pdf')
    expect(extensaoDe('foto.final.JPG')).toBe('.jpg')
  })

  it('ignora o caminho antes do nome', () => {
    expect(extensaoDe('/tmp/pasta/arquivo.txt')).toBe('.txt')
  })

  it('devolve vazio quando não há extensão plausível', () => {
    expect(extensaoDe('arquivo')).toBe('')
    expect(extensaoDe('.gitignore')).toBe('')
    expect(extensaoDe('arquivo.')).toBe('')
    expect(extensaoDe('nome.extensaomuitolonga')).toBe('')
    expect(extensaoDe('')).toBe('')
  })
})

describe('nomeSeguro', () => {
  it('mantém nomes normais (acentos inclusive)', () => {
    expect(nomeSeguro('Petição inicial.docx')).toBe('Petição inicial.docx')
  })

  it('remove caminho e caracteres proibidos', () => {
    expect(nomeSeguro('pasta/sub/nota:1?.pdf')).toBe('nota1.pdf')
    expect(nomeSeguro('C:\\Users\\ana\\a<b>c.txt')).toBe('abc.txt')
  })

  it('encurta nome comprido SEM perder a extensão', () => {
    const comprido = `${'a'.repeat(200)}.docx`
    const curto = nomeSeguro(comprido)
    expect(curto.endsWith('.docx')).toBe(true)
    expect(curto.length).toBeLessThanOrEqual(120)
  })

  it('não parte emoji ao meio ao encurtar', () => {
    // 130 emojis (2 code units cada): cortar por índice deixaria meio surrogado.
    const curto = nomeSeguro(`${'😀'.repeat(130)}.pdf`)
    expect(curto.endsWith('.pdf')).toBe(true)
    expect(/[\uD800-\uDFFF]/.test(curto.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))).toBe(false)
  })

  it('cai no padrão quando sobra nada', () => {
    expect(nomeSeguro('')).toBe('arquivo')
    expect(nomeSeguro('???')).toBe('arquivo')
    expect(nomeSeguro('   ', 'anexo')).toBe('anexo')
  })
})

describe('extensaoDoMime', () => {
  it('resolve os formatos conhecidos', () => {
    expect(extensaoDoMime('application/pdf')).toBe('.pdf')
    expect(extensaoDoMime('image/jpeg')).toBe('.jpg')
    expect(extensaoDoMime('audio/ogg;codecs=opus')).toBe('.ogg')
  })

  it('vazio quando genérico ou desconhecido', () => {
    expect(extensaoDoMime('application/octet-stream')).toBe('')
    expect(extensaoDoMime('application/x-coisa')).toBe('')
    expect(extensaoDoMime(null)).toBe('')
    expect(extensaoDoMime(undefined)).toBe('')
  })
})

describe('nomeDaUrlDeDownload', () => {
  it('lê o nome que o servidor colocou na signed URL', () => {
    expect(nomeDaUrlDeDownload('https://x.supabase.co/a.pdf?token=1&download=comprovante-2026-07-11.pdf'))
      .toBe('comprovante-2026-07-11.pdf')
  })

  it('decodifica nome com espaço/acento', () => {
    expect(nomeDaUrlDeDownload('/api/doc?download=Peti%C3%A7%C3%A3o%20inicial.docx'))
      .toBe('Petição inicial.docx')
  })

  it('null quando não há nome de verdade', () => {
    expect(nomeDaUrlDeDownload('https://x.supabase.co/a.pdf?token=1')).toBeNull()
    expect(nomeDaUrlDeDownload('https://x.supabase.co/a.pdf?download=true')).toBeNull()
    expect(nomeDaUrlDeDownload('https://x.supabase.co/a.pdf?download=')).toBeNull()
    expect(nomeDaUrlDeDownload('')).toBeNull()
  })
})

describe('tiposDoPicker', () => {
  it('monta o filtro a partir da extensão quando não há mimetype', () => {
    expect(tiposDoPicker('Contrato.docx')).toEqual([
      {
        description: 'Documento do Word',
        accept: {
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
        },
      },
    ])
  })

  it('usa o mimetype declarado quando ele é útil', () => {
    expect(tiposDoPicker('comprovante.pdf', 'application/pdf')).toEqual([
      { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } },
    ])
  })

  it('aceita mimetype com charset', () => {
    expect(tiposDoPicker('transcricao.txt', 'text/plain;charset=utf-8')).toEqual([
      { description: 'Arquivo de texto', accept: { 'text/plain': ['.txt'] } },
    ])
  })

  it('ignora octet-stream e cai na extensão (caso do proxy de anexos)', () => {
    expect(tiposDoPicker('recibo.pdf', 'application/octet-stream')).toEqual([
      { description: 'PDF', accept: { 'application/pdf': ['.pdf'] } },
    ])
  })

  it('deduz a extensão a partir do mimetype quando o nome não tem', () => {
    expect(tiposDoPicker('audio-do-cliente', 'audio/ogg')).toEqual([
      { description: 'Áudio', accept: { 'audio/ogg': ['.ogg'] } },
    ])
  })

  it('sem filtro quando o formato é desconhecido — o seletor abre livre', () => {
    expect(tiposDoPicker('arquivo')).toBeUndefined()
    expect(tiposDoPicker('backup.qqq')).toBeUndefined()
    expect(tiposDoPicker('anexo', 'application/octet-stream')).toBeUndefined()
    expect(tiposDoPicker('anexo', 'lixo-sem-barra')).toBeUndefined()
  })
})
