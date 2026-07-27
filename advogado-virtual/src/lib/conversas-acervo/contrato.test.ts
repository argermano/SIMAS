import { describe, it, expect } from 'vitest'
import {
  LOTE_MAX_EVENTOS,
  eventoSchema,
  loteEventosSchema,
  prepararMediaSchema,
} from './contrato'

// O CONTRATO é a fonte da verdade das DUAS pontas (encaminhador no VPS × SIMAS).
// Estes testes travam o formato: quebrar um deles significa quebrar o VPS.

const eventoMinimo = {
  instancia: 'whatsapp-sc',
  mensagemId: '3EB0ABC',
  conversaJid: '5547991186787@s.whatsapp.net',
  tipoConversa: 'individual',
  deMim: false,
  timestamp: 1_753_000_000_000,
  tipo: 'texto',
}

describe('eventoSchema — campos obrigatórios', () => {
  it('aceita o evento mínimo do contrato', () => {
    expect(eventoSchema.safeParse(eventoMinimo).success).toBe(true)
  })

  it('aceita o evento completo (grupo, mídia guardada)', () => {
    const completo = {
      ...eventoMinimo,
      conversaJid: '120363000@g.us',
      tipoConversa: 'grupo',
      tituloGrupo: 'Família Silva',
      deMim: true,
      origemProvavel: 'sistema',
      autorJid: '5547999999999@s.whatsapp.net',
      pushName: 'Solange',
      tipo: 'documento',
      texto: 'segue o contrato',
      media: {
        storagePath: 'tenant/conversas-acervo/whatsapp-sc/x/3EB0ABC_doc.pdf',
        filename: 'doc.pdf',
        mimetype: 'application/pdf',
        tamanho: 1234,
      },
    }
    expect(eventoSchema.safeParse(completo).success).toBe(true)
  })

  it('aceita mídia PENDENTE (a existência da mídia é registrada mesmo sem o binário)', () => {
    const parsed = eventoSchema.safeParse({
      ...eventoMinimo,
      tipo: 'imagem',
      media: { pendente: true, motivo: 'download_falhou' },
    })
    expect(parsed.success).toBe(true)
  })

  it('recusa instância desconhecida, tipo fora da lista e id vazio', () => {
    expect(eventoSchema.safeParse({ ...eventoMinimo, instancia: 'whatsapp-rj' }).success).toBe(false)
    expect(eventoSchema.safeParse({ ...eventoMinimo, tipo: 'enquete' }).success).toBe(false)
    expect(eventoSchema.safeParse({ ...eventoMinimo, mensagemId: '' }).success).toBe(false)
    expect(eventoSchema.safeParse({ ...eventoMinimo, conversaJid: '' }).success).toBe(false)
    expect(eventoSchema.safeParse({ ...eventoMinimo, tipoConversa: 'canal' }).success).toBe(false)
  })

  it('recusa timestamp não positivo ou não inteiro', () => {
    expect(eventoSchema.safeParse({ ...eventoMinimo, timestamp: 0 }).success).toBe(false)
    expect(eventoSchema.safeParse({ ...eventoMinimo, timestamp: -1 }).success).toBe(false)
    expect(eventoSchema.safeParse({ ...eventoMinimo, timestamp: 1.5 }).success).toBe(false)
  })

  it('recusa mídia meia-boca (nem completa nem pendente)', () => {
    expect(
      eventoSchema.safeParse({ ...eventoMinimo, media: { storagePath: 'a/b.pdf' } }).success,
    ).toBe(false)
    expect(eventoSchema.safeParse({ ...eventoMinimo, media: { pendente: true } }).success).toBe(false)
  })

  it('texto gigante NÃO derruba o evento (truncar é papel da normalização)', () => {
    const parsed = eventoSchema.safeParse({ ...eventoMinimo, texto: 'a'.repeat(200_000) })
    expect(parsed.success).toBe(true)
  })
})

describe('loteEventosSchema — teto de 50', () => {
  it('aceita lote de 1 até o teto', () => {
    expect(loteEventosSchema.safeParse({ eventos: [eventoMinimo] }).success).toBe(true)
    const cheio = Array.from({ length: LOTE_MAX_EVENTOS }, (_, i) => ({
      ...eventoMinimo,
      mensagemId: `m${i}`,
    }))
    expect(loteEventosSchema.safeParse({ eventos: cheio }).success).toBe(true)
  })

  it('recusa lote vazio e lote acima do teto', () => {
    expect(loteEventosSchema.safeParse({ eventos: [] }).success).toBe(false)
    const excedente = Array.from({ length: LOTE_MAX_EVENTOS + 1 }, (_, i) => ({
      ...eventoMinimo,
      mensagemId: `m${i}`,
    }))
    expect(loteEventosSchema.safeParse({ eventos: excedente }).success).toBe(false)
  })

  it('recusa corpo sem a chave eventos', () => {
    expect(loteEventosSchema.safeParse({}).success).toBe(false)
    expect(loteEventosSchema.safeParse({ eventos: eventoMinimo }).success).toBe(false)
  })
})

describe('prepararMediaSchema', () => {
  const minimo = {
    instancia: 'whatsapp-df',
    mensagemId: '3EB0ABC',
    filename: 'audio.ogg',
    mimetype: 'audio/ogg',
    tamanho: 2048,
  }

  it('aceita o corpo mínimo do contrato (sem conversaJid)', () => {
    expect(prepararMediaSchema.safeParse(minimo).success).toBe(true)
  })

  it('aceita conversaJid opcional (path organizado por conversa)', () => {
    expect(prepararMediaSchema.safeParse({ ...minimo, conversaJid: '1@g.us' }).success).toBe(true)
  })

  it('recusa tamanho zero/negativo e instância desconhecida', () => {
    expect(prepararMediaSchema.safeParse({ ...minimo, tamanho: 0 }).success).toBe(false)
    expect(prepararMediaSchema.safeParse({ ...minimo, tamanho: -1 }).success).toBe(false)
    expect(prepararMediaSchema.safeParse({ ...minimo, instancia: 'x' }).success).toBe(false)
    expect(prepararMediaSchema.safeParse({ ...minimo, filename: '' }).success).toBe(false)
  })
})
