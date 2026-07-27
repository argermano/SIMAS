import { describe, it, expect } from 'vitest'
import { LIMITE_MEDIA_BYTES, LIMITE_TEXTO_CHARS, type EventoConversa } from './contrato'
import {
  caminhoMediaAcervo,
  conversaChave,
  conversasDoLote,
  deduplicarEventos,
  linhaMensagem,
  mensagemChave,
  normalizarTexto,
  normalizarTitulo,
  origemDoEvento,
  patchDeConversa,
  pathMediaAcervoValido,
  prefixoAcervo,
  sanitizarSegmentoPath,
  timestampParaIso,
  validarMediaAcervo,
} from './normalizar'

const TENANT = '11111111-1111-1111-1111-111111111111'
const CONVERSA = '22222222-2222-2222-2222-222222222222'

function evento(over: Partial<EventoConversa> = {}): EventoConversa {
  return {
    instancia: 'whatsapp-sc',
    mensagemId: '3EB0ABC',
    conversaJid: '5547991186787@s.whatsapp.net',
    tipoConversa: 'individual',
    deMim: false,
    timestamp: 1_753_000_000_000,
    tipo: 'texto',
    ...over,
  }
}

describe('chaves', () => {
  it('conversa = instancia:jid; mensagem = instancia:id da Evolution', () => {
    expect(conversaChave('whatsapp-sc', '55@s.whatsapp.net')).toBe('whatsapp-sc:55@s.whatsapp.net')
    expect(mensagemChave('whatsapp-df', '3EB0')).toBe('whatsapp-df:3EB0')
  })

  it('mesma pessoa em instâncias diferentes = conversas diferentes', () => {
    expect(conversaChave('whatsapp-sc', 'x@s.whatsapp.net'))
      .not.toBe(conversaChave('whatsapp-df', 'x@s.whatsapp.net'))
  })
})

describe('sanitizarSegmentoPath — anti-traversal', () => {
  it('troca separadores de caminho e caracteres perigosos', () => {
    expect(sanitizarSegmentoPath('a/b\\c', 'x')).toBe('a_b_c')
    expect(sanitizarSegmentoPath('5547991186787@s.whatsapp.net', 'x'))
      .toBe('5547991186787_s.whatsapp.net')
  })

  it('nenhum segmento consegue virar ".." (nem "..." nem "a/../b")', () => {
    expect(sanitizarSegmentoPath('..', 'x')).toBe('_')
    expect(sanitizarSegmentoPath('...', 'x')).toBe('_')
    expect(sanitizarSegmentoPath('../../etc/passwd', 'x')).toBe('____etc_passwd')
    expect(sanitizarSegmentoPath('a/../b', 'x')).not.toContain('..')
  })

  it('vazio/só símbolos cai no padrão', () => {
    expect(sanitizarSegmentoPath('', 'sem-jid')).toBe('sem-jid')
    expect(sanitizarSegmentoPath(null, 'msg')).toBe('msg')
    expect(sanitizarSegmentoPath('   ', 'arquivo')).toBe('arquivo')
  })
})

describe('caminhoMediaAcervo', () => {
  it('monta <tenant>/conversas-acervo/<instancia>/<jid>/<msg>_<nome>', () => {
    expect(
      caminhoMediaAcervo({
        tenantId: TENANT,
        instancia: 'whatsapp-sc',
        conversaJid: '120363@g.us',
        mensagemId: '3EB0ABC',
        filename: 'Contrato final.pdf',
      }),
    ).toBe(`${TENANT}/conversas-acervo/whatsapp-sc/120363_g.us/3EB0ABC_Contrato_final.pdf`)
  })

  it('sem jid usa o segmento "sem-jid" (contrato mínimo do preparar-media)', () => {
    const path = caminhoMediaAcervo({
      tenantId: TENANT,
      instancia: 'whatsapp-df',
      mensagemId: 'm1',
      filename: 'a.ogg',
    })
    expect(path).toBe(`${TENANT}/conversas-acervo/whatsapp-df/sem-jid/m1_a.ogg`)
  })

  it('entrada hostil nunca escapa do prefixo do tenant', () => {
    const path = caminhoMediaAcervo({
      tenantId: TENANT,
      instancia: '../../outro-tenant',
      conversaJid: '../..',
      mensagemId: '../etc',
      filename: '../../passwd',
    })
    expect(path.startsWith(prefixoAcervo(TENANT))).toBe(true)
    expect(path).not.toContain('..')
  })
})

describe('pathMediaAcervoValido', () => {
  it('aceita só o prefixo do próprio tenant', () => {
    expect(pathMediaAcervoValido(`${TENANT}/conversas-acervo/whatsapp-sc/x/y.pdf`, TENANT)).toBe(true)
  })

  it('recusa outro tenant, outra área do bucket, traversal e vazios', () => {
    const outro = '33333333-3333-3333-3333-333333333333'
    expect(pathMediaAcervoValido(`${outro}/conversas-acervo/a/b.pdf`, TENANT)).toBe(false)
    expect(pathMediaAcervoValido(`${TENANT}/contratos/segredo.pdf`, TENANT)).toBe(false)
    expect(pathMediaAcervoValido(`${TENANT}/conversas-acervo/../../x.pdf`, TENANT)).toBe(false)
    expect(pathMediaAcervoValido('', TENANT)).toBe(false)
    expect(pathMediaAcervoValido(null, TENANT)).toBe(false)
    expect(pathMediaAcervoValido(`${TENANT}/conversas-acervo/a.pdf`, null)).toBe(false)
  })
})

describe('validarMediaAcervo — só tamanho (tipo livre no acervo)', () => {
  it('aceita qualquer mimetype dentro do teto', () => {
    expect(validarMediaAcervo({ tamanho: 1 }).ok).toBe(true)
    expect(validarMediaAcervo({ tamanho: LIMITE_MEDIA_BYTES }).ok).toBe(true)
  })

  it('recusa tamanho inválido (400) e acima de 40 MB (413)', () => {
    expect(validarMediaAcervo({ tamanho: 0 })).toMatchObject({ ok: false, status: 400 })
    expect(validarMediaAcervo({ tamanho: -5 })).toMatchObject({ ok: false, status: 400 })
    expect(validarMediaAcervo({ tamanho: Number.NaN })).toMatchObject({ ok: false, status: 400 })
    expect(validarMediaAcervo({ tamanho: LIMITE_MEDIA_BYTES + 1 })).toMatchObject({
      ok: false,
      status: 413,
    })
  })
})

describe('timestampParaIso', () => {
  const agora = Date.parse('2026-07-27T12:00:00.000Z')

  it('epoch em milissegundos (contrato)', () => {
    expect(timestampParaIso(Date.parse('2026-07-20T10:30:00.000Z'), agora))
      .toBe('2026-07-20T10:30:00.000Z')
  })

  it('tolera epoch em SEGUNDOS (a Evolution manda assim em vários payloads)', () => {
    expect(timestampParaIso(Date.parse('2026-07-20T10:30:00.000Z') / 1000, agora))
      .toBe('2026-07-20T10:30:00.000Z')
  })

  it('valor absurdo (futuro distante, zero, NaN) cai no agora — nunca perde a mensagem', () => {
    const agoraIso = new Date(agora).toISOString()
    expect(timestampParaIso(agora + 10 * 86_400_000, agora)).toBe(agoraIso)
    expect(timestampParaIso(0, agora)).toBe(agoraIso)
    expect(timestampParaIso(Number.NaN, agora)).toBe(agoraIso)
    expect(timestampParaIso(-1, agora)).toBe(agoraIso)
  })

  it('relógio do aparelho até 1 dia adiantado é respeitado', () => {
    expect(timestampParaIso(agora + 3_600_000, agora)).toBe(new Date(agora + 3_600_000).toISOString())
  })
})

describe('normalizarTexto / normalizarTitulo / origemDoEvento', () => {
  it('texto vazio vira null e o gigante é truncado (nunca 400)', () => {
    expect(normalizarTexto('  oi  ')).toBe('oi')
    expect(normalizarTexto('   ')).toBeNull()
    expect(normalizarTexto(undefined)).toBeNull()
    expect(normalizarTexto('a'.repeat(LIMITE_TEXTO_CHARS + 10))?.length).toBe(LIMITE_TEXTO_CHARS)
  })

  it('título só existe em grupo', () => {
    expect(normalizarTitulo(evento({ tipoConversa: 'grupo', tituloGrupo: 'Família Silva' })))
      .toBe('Família Silva')
    expect(normalizarTitulo(evento({ tipoConversa: 'grupo', tituloGrupo: '  ' }))).toBeNull()
    expect(normalizarTitulo(evento({ tipoConversa: 'individual', tituloGrupo: 'x' }))).toBeNull()
  })

  it('origem só vale quando a mensagem saiu do nosso número', () => {
    expect(origemDoEvento(evento({ deMim: true, origemProvavel: 'sistema' }))).toBe('sistema')
    expect(origemDoEvento(evento({ deMim: true, origemProvavel: 'atendente' }))).toBe('atendente')
    expect(origemDoEvento(evento({ deMim: true }))).toBeNull()
    expect(origemDoEvento(evento({ deMim: false, origemProvavel: 'sistema' }))).toBeNull()
  })
})

describe('deduplicarEventos', () => {
  it('mantém a primeira ocorrência e conta as repetidas', () => {
    const r = deduplicarEventos([
      evento({ mensagemId: 'a', texto: 'primeira' }),
      evento({ mensagemId: 'a', texto: 'repetida' }),
      evento({ mensagemId: 'b' }),
    ])
    expect(r.unicos).toHaveLength(2)
    expect(r.unicos[0].texto).toBe('primeira')
    expect(r.duplicadosNoLote).toBe(1)
  })

  it('mesmo id em instâncias diferentes NÃO é duplicata', () => {
    const r = deduplicarEventos([
      evento({ mensagemId: 'a', instancia: 'whatsapp-sc' }),
      evento({ mensagemId: 'a', instancia: 'whatsapp-df' }),
    ])
    expect(r.unicos).toHaveLength(2)
    expect(r.duplicadosNoLote).toBe(0)
  })

  it('lote vazio', () => {
    expect(deduplicarEventos([])).toEqual({ unicos: [], duplicadosNoLote: 0 })
  })
})

describe('conversasDoLote', () => {
  // Relógio fixo: a normalização do timestamp compara com "agora".
  const AGORA_MS = Date.parse('2026-07-27T12:00:00.000Z')

  it('agrupa por instancia+jid e guarda o maior timestamp', () => {
    const conversas = conversasDoLote(
      [
        evento({ mensagemId: '1', timestamp: 1_700_000_000_000 }),
        evento({ mensagemId: '2', timestamp: 1_700_000_500_000 }),
        evento({ mensagemId: '3', conversaJid: 'outro@s.whatsapp.net' }),
      ],
      AGORA_MS,
    )
    expect(conversas).toHaveLength(2)
    const principal = conversas.find((c) => c.jid === '5547991186787@s.whatsapp.net')!
    expect(principal.ultimaMensagemEm).toBe(new Date(1_700_000_500_000).toISOString())
    expect(principal.tipo).toBe('individual')
    expect(principal.titulo).toBeNull()
  })

  it('grupo: fica com o subject do evento mais recente', () => {
    const [grupo] = conversasDoLote(
      [
        evento({ mensagemId: '1', conversaJid: '1@g.us', tipoConversa: 'grupo', tituloGrupo: 'Nome antigo', timestamp: 1_700_000_000_000 }),
        evento({ mensagemId: '2', conversaJid: '1@g.us', tipoConversa: 'grupo', tituloGrupo: 'Nome novo', timestamp: 1_700_000_900_000 }),
      ],
      AGORA_MS,
    )
    expect(grupo.titulo).toBe('Nome novo')
    expect(grupo.tipo).toBe('grupo')
  })

  it('evento mais recente SEM subject não apaga o título de um evento antigo', () => {
    const [grupo] = conversasDoLote(
      [
        evento({ mensagemId: '1', conversaJid: '1@g.us', tipoConversa: 'grupo', tituloGrupo: 'Família Silva', timestamp: 1_700_000_000_000 }),
        evento({ mensagemId: '2', conversaJid: '1@g.us', tipoConversa: 'grupo', timestamp: 1_700_000_900_000 }),
      ],
      AGORA_MS,
    )
    expect(grupo.titulo).toBe('Família Silva')
  })
})

describe('patchDeConversa', () => {
  const desejada = {
    chave: 'whatsapp-sc:1@g.us',
    instancia: 'whatsapp-sc' as const,
    jid: '1@g.us',
    tipo: 'grupo' as const,
    titulo: 'Família Silva',
    ultimaMensagemEm: '2026-07-20T10:00:00.000Z',
  }
  const AGORA = '2026-07-27T12:00:00.000Z'

  it('nada a mudar → null (sem UPDATE inútil)', () => {
    expect(
      patchDeConversa(
        { id: 'x', tipo: 'grupo', titulo: 'Família Silva', ultima_mensagem_em: '2026-07-20T10:00:00.000Z' },
        desejada,
        AGORA,
      ),
    ).toBeNull()
  })

  it('ultima_mensagem_em SÓ AVANÇA (evento atrasado/backfill não envelhece a conversa)', () => {
    const patch = patchDeConversa(
      { id: 'x', tipo: 'grupo', titulo: 'Família Silva', ultima_mensagem_em: '2026-07-25T10:00:00.000Z' },
      desejada,
      AGORA,
    )
    expect(patch).toBeNull()
  })

  it('avança quando a nova é mais recente (ou não havia nenhuma)', () => {
    expect(
      patchDeConversa(
        { id: 'x', tipo: 'grupo', titulo: 'Família Silva', ultima_mensagem_em: '2026-07-01T10:00:00.000Z' },
        desejada,
        AGORA,
      ),
    ).toEqual({ ultima_mensagem_em: desejada.ultimaMensagemEm, atualizado_em: AGORA })

    expect(
      patchDeConversa(
        { id: 'x', tipo: 'grupo', titulo: 'Família Silva', ultima_mensagem_em: null },
        desejada,
        AGORA,
      ),
    ).toEqual({ ultima_mensagem_em: desejada.ultimaMensagemEm, atualizado_em: AGORA })
  })

  it('renomeia o grupo, mas evento sem título nunca apaga o existente', () => {
    expect(
      patchDeConversa(
        { id: 'x', tipo: 'grupo', titulo: 'Nome antigo', ultima_mensagem_em: '2026-07-20T10:00:00.000Z' },
        desejada,
        AGORA,
      ),
    ).toEqual({ titulo: 'Família Silva', atualizado_em: AGORA })

    expect(
      patchDeConversa(
        { id: 'x', tipo: 'grupo', titulo: 'Nome antigo', ultima_mensagem_em: '2026-07-20T10:00:00.000Z' },
        { ...desejada, titulo: null },
        AGORA,
      ),
    ).toBeNull()
  })

  it('corrige a classificação individual → grupo', () => {
    expect(
      patchDeConversa(
        { id: 'x', tipo: 'individual', titulo: 'Família Silva', ultima_mensagem_em: '2026-07-20T10:00:00.000Z' },
        desejada,
        AGORA,
      ),
    ).toEqual({ tipo: 'grupo', atualizado_em: AGORA })
  })
})

describe('linhaMensagem', () => {
  const ctx = { tenantId: TENANT, conversaId: CONVERSA }

  it('mensagem de texto recebida', () => {
    const linha = linhaMensagem(
      evento({ texto: '  Bom dia, doutora  ', pushName: ' Solange ' }),
      ctx,
    )
    expect(linha).toMatchObject({
      tenant_id: TENANT,
      conversa_id: CONVERSA,
      mensagem_id: '3EB0ABC',
      instancia: 'whatsapp-sc',
      de_mim: false,
      origem: null,
      autor_jid: null,
      push_name: 'Solange',
      tipo: 'texto',
      texto: 'Bom dia, doutora',
      media_storage_path: null,
      media_pendente_motivo: null,
    })
  })

  it('mídia guardada no nosso prefixo é aceita inteira', () => {
    const storagePath = `${TENANT}/conversas-acervo/whatsapp-sc/x/3EB0ABC_doc.pdf`
    const linha = linhaMensagem(
      evento({
        tipo: 'documento',
        media: { storagePath, filename: 'doc.pdf', mimetype: 'application/pdf', tamanho: 1234 },
      }),
      ctx,
    )
    expect(linha.media_storage_path).toBe(storagePath)
    expect(linha.media_filename).toBe('doc.pdf')
    expect(linha.media_mimetype).toBe('application/pdf')
    expect(linha.media_tamanho).toBe(1234)
    expect(linha.media_pendente_motivo).toBeNull()
  })

  it('mídia pendente registra a EXISTÊNCIA (é o buraco que motivou o plano)', () => {
    const linha = linhaMensagem(
      evento({ tipo: 'imagem', media: { pendente: true, motivo: 'download_falhou' } }),
      ctx,
    )
    expect(linha.media_storage_path).toBeNull()
    expect(linha.media_pendente_motivo).toBe('download_falhou')
    expect(linha.tipo).toBe('imagem')
  })

  it('storagePath de OUTRO tenant/área é recusado e vira path_invalido', () => {
    const linha = linhaMensagem(
      evento({
        tipo: 'documento',
        media: {
          storagePath: '99999999-9999-9999-9999-999999999999/conversas-acervo/x/y.pdf',
          filename: 'y.pdf',
          mimetype: 'application/pdf',
          tamanho: 10,
        },
      }),
      ctx,
    )
    expect(linha.media_storage_path).toBeNull()
    expect(linha.media_pendente_motivo).toBe('path_invalido')
  })

  it('tamanho acima do teto do contrato não é gravado como mídia', () => {
    const linha = linhaMensagem(
      evento({
        tipo: 'video',
        media: {
          storagePath: `${TENANT}/conversas-acervo/whatsapp-sc/x/v.mp4`,
          filename: 'v.mp4',
          mimetype: 'video/mp4',
          tamanho: LIMITE_MEDIA_BYTES + 1,
        },
      }),
      ctx,
    )
    expect(linha.media_storage_path).toBeNull()
    expect(linha.media_tamanho).toBeNull()
    expect(linha.media_pendente_motivo).toBe('excede_teto')
  })

  it('mensagem nossa em grupo guarda origem e autor', () => {
    const linha = linhaMensagem(
      evento({
        conversaJid: '1@g.us',
        tipoConversa: 'grupo',
        deMim: true,
        origemProvavel: 'atendente',
        autorJid: '5547999999999@s.whatsapp.net',
        texto: 'segue em anexo',
      }),
      ctx,
    )
    expect(linha.de_mim).toBe(true)
    expect(linha.origem).toBe('atendente')
    expect(linha.autor_jid).toBe('5547999999999@s.whatsapp.net')
  })
})
