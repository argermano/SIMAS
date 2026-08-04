import { describe, it, expect } from 'vitest'
import {
  LIMITE_TRECHO_CITACAO,
  autorCitacao,
  encurtarTrecho,
  indexarPorId,
  midiaDoTipoAnexo,
  podeResponder,
  resolverCitada,
  resumoCitacao,
  rotuloMidia,
} from './citacao'
import type { Mensagem } from './tipos'

function msg(p: Partial<Mensagem> = {}): Mensagem {
  return {
    id: 1,
    direcao: 'entrada',
    privada: false,
    conteudo: '',
    anexos: [],
    sender: { tipo: 'cliente', nome: 'Marta' },
    timestamp: 1_700_000_000,
    ...p,
  }
}

describe('podeResponder (quais bolhas oferecem "Responder")', () => {
  it('vale para entrada E saída — no WhatsApp responde-se qualquer mensagem', () => {
    expect(podeResponder(msg({ direcao: 'entrada' }))).toBe(true)
    expect(podeResponder(msg({ direcao: 'saida' }))).toBe(true)
  })

  it('não vale para nota interna nem para atividade do sistema', () => {
    expect(podeResponder(msg({ direcao: 'entrada', privada: true }))).toBe(false)
    expect(podeResponder(msg({ direcao: 'saida', privada: true }))).toBe(false)
    expect(podeResponder(msg({ direcao: 'atividade' }))).toBe(false)
  })
})

describe('midiaDoTipoAnexo / rotuloMidia', () => {
  it('mapeia os file_type do relay', () => {
    expect(midiaDoTipoAnexo('image')).toBe('imagem')
    expect(midiaDoTipoAnexo('video')).toBe('video')
    expect(midiaDoTipoAnexo('audio')).toBe('audio')
    expect(midiaDoTipoAnexo('location')).toBe('localizacao')
    expect(midiaDoTipoAnexo('contact')).toBe('contato')
  })

  it('cai em documento para file/desconhecido/vazio', () => {
    expect(midiaDoTipoAnexo('file')).toBe('documento')
    expect(midiaDoTipoAnexo('sticker')).toBe('documento')
    expect(midiaDoTipoAnexo(undefined)).toBe('documento')
  })

  it('rotula em pt-BR como o WhatsApp', () => {
    expect(rotuloMidia('imagem')).toBe('Foto')
    expect(rotuloMidia('video')).toBe('Vídeo')
    expect(rotuloMidia('audio')).toBe('Áudio')
    expect(rotuloMidia('documento')).toBe('Documento')
    expect(rotuloMidia('localizacao')).toBe('Localização')
    expect(rotuloMidia('contato')).toBe('Contato')
  })
})

describe('encurtarTrecho', () => {
  it('achata quebras de linha e espaços repetidos numa linha só', () => {
    expect(encurtarTrecho('  bom   dia\n\ndoutor  ')).toBe('bom dia doutor')
  })

  it('devolve intacto o que cabe no limite', () => {
    const t = 'a'.repeat(LIMITE_TRECHO_CITACAO)
    expect(encurtarTrecho(t)).toBe(t)
  })

  it('corta no limite e marca com reticências', () => {
    const cortado = encurtarTrecho('b'.repeat(LIMITE_TRECHO_CITACAO + 40))
    expect(cortado).toBe(`${'b'.repeat(LIMITE_TRECHO_CITACAO)}…`)
    expect(Array.from(cortado)).toHaveLength(LIMITE_TRECHO_CITACAO + 1)
  })

  it('não deixa espaço solto antes das reticências', () => {
    expect(encurtarTrecho('abc def', 4)).toBe('abc…')
  })

  it('corta por ponto de código — não parte emoji ao meio', () => {
    // 5 emoji fora do BMP: .slice(0, 3) partiria o par substituto.
    expect(encurtarTrecho('👨‍⚖️'.repeat(0) + '😀😀😀😀😀', 3)).toBe('😀😀😀…')
  })

  it('trata limite zero/negativo e texto vazio sem estourar', () => {
    expect(encurtarTrecho('qualquer', 0)).toBe('')
    expect(encurtarTrecho('qualquer', -5)).toBe('')
    expect(encurtarTrecho('   ')).toBe('')
  })
})

describe('resumoCitacao', () => {
  it('só texto: trecho encurtado, sem mídia', () => {
    expect(resumoCitacao(msg({ conteudo: 'preciso do contrato' }))).toEqual({
      midia: null,
      trecho: 'preciso do contrato',
    })
  })

  it('mídia sem legenda: rótulo da mídia', () => {
    const r = resumoCitacao(msg({ anexos: [{ tipo: 'image', url: 'https://x/y.jpg' }] }))
    expect(r).toEqual({ midia: 'imagem', trecho: 'Foto' })
  })

  it('mídia com legenda: mostra a legenda e mantém o ícone da mídia', () => {
    const r = resumoCitacao(
      msg({ conteudo: 'segue o comprovante', anexos: [{ tipo: 'file', url: 'https://x/y.pdf' }] }),
    )
    expect(r).toEqual({ midia: 'documento', trecho: 'segue o comprovante' })
  })

  it('encurta a legenda longa da mídia', () => {
    const r = resumoCitacao(
      msg({ conteudo: 'c'.repeat(200), anexos: [{ tipo: 'audio', url: 'https://x/y.ogg' }] }),
      10,
    )
    expect(r).toEqual({ midia: 'audio', trecho: `${'c'.repeat(10)}…` })
  })

  it('sem conteúdo e sem anexo: rótulo neutro (defensivo)', () => {
    expect(resumoCitacao(msg())).toEqual({ midia: null, trecho: 'Mensagem' })
  })

  it('aguenta anexos ausentes vindos de um relay antigo', () => {
    const semAnexos = { conteudo: 'oi' } as unknown as Mensagem
    expect(resumoCitacao(semAnexos)).toEqual({ midia: null, trecho: 'oi' })
  })
})

describe('autorCitacao', () => {
  it('entrada usa quem escreveu — em GRUPO, o participante, não o nome do grupo', () => {
    const m = msg({ direcao: 'entrada', sender: { tipo: 'cliente', nome: 'João' } })
    expect(autorCitacao(m, { nomeContato: 'Escritório pai' })).toBe('João')
  })

  it('entrada sem sender cai no contato da conversa e depois em "Cliente"', () => {
    const semSender = msg({ direcao: 'entrada', sender: { tipo: 'cliente', nome: '' } })
    expect(autorCitacao(semSender, { nomeContato: 'Marta Silva' })).toBe('Marta Silva')
    expect(autorCitacao(semSender, { nomeContato: '  ' })).toBe('Cliente')
    expect(autorCitacao(semSender)).toBe('Cliente')
  })

  it('saída do próprio agente conectado vira "Você"', () => {
    const m = msg({ direcao: 'saida', sender: { tipo: 'agente', nome: 'Anderson' } })
    expect(autorCitacao(m, { nomeAgente: 'Anderson' })).toBe('Você')
  })

  it('saída de OUTRO agente mantém o nome dele', () => {
    const m = msg({ direcao: 'saida', sender: { tipo: 'agente', nome: 'Katlen' } })
    expect(autorCitacao(m, { nomeAgente: 'Anderson' })).toBe('Katlen')
  })

  it('saída do bot mantém o nome do bot mesmo casando com o agente conectado', () => {
    const m = msg({ direcao: 'saida', sender: { tipo: 'bot', nome: 'Anderson' } })
    expect(autorCitacao(m, { nomeAgente: 'Anderson' })).toBe('Anderson')
  })

  it('saída sem nome nenhum cai em "Você"', () => {
    const m = msg({ direcao: 'saida', sender: { tipo: 'agente', nome: '' } })
    expect(autorCitacao(m)).toBe('Você')
  })
})

describe('resolverCitada (resolução local, sem fetch)', () => {
  const lista = [msg({ id: 10 }), msg({ id: 11 }), msg({ id: 12 })]

  it('acha a mensagem de mesmo id na página carregada', () => {
    expect(resolverCitada(lista, 11)?.id).toBe(11)
  })

  it('devolve null quando a citada ficou fora da página (bloco genérico)', () => {
    expect(resolverCitada(lista, 7)).toBeNull()
  })

  it('devolve null sem citação (null/undefined/NaN)', () => {
    expect(resolverCitada(lista, null)).toBeNull()
    expect(resolverCitada(lista, undefined)).toBeNull()
    expect(resolverCitada(lista, Number.NaN)).toBeNull()
  })
})

describe('indexarPorId', () => {
  it('indexa a página inteira por id', () => {
    const mapa = indexarPorId([msg({ id: 10 }), msg({ id: 11 })])
    expect(mapa.get(11)?.id).toBe(11)
    expect(mapa.get(99)).toBeUndefined()
    expect(mapa.size).toBe(2)
  })

  it('vazio para lista vazia', () => {
    expect(indexarPorId([]).size).toBe(0)
  })
})
