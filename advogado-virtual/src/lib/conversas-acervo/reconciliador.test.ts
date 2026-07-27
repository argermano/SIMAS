import { describe, it, expect } from 'vitest'
import {
  codigoDetalhe,
  elegivelParaPostar,
  idadeMinimaMs,
  interpretarResposta,
  inboxContrato,
  janelaMaximaMs,
  LIMITE_POST_BYTES,
  LIMITE_TEXTO_POST,
  MAX_TENTATIVAS,
  modoReconciliacao,
  montarPayload,
  NOTA_ANEXO_PERDIDO,
  ordenarParaPostagem,
  payloadReconciliacaoSchema,
  pendenteDaLinha,
  TETO_GRUPO_SEM_CONVERSA,
  temConteudoPostavel,
  tetoTentativas,
  textoParaPost,
  type CriteriosElegibilidade,
  type MensagemPendente,
} from './reconciliador'

// Lógica PURA do reconciliador (083 / plano Conversas Próprias, Etapa 1):
// quem pode ser reposto, em que ordem, com que corpo — e como se lê a resposta
// do relay. Nada aqui toca banco, storage ou rede.

const TENANT = '11111111-1111-1111-1111-111111111111'
const T0 = Date.parse('2026-07-27T12:00:00.000Z')
const DEZ_MIN = 10 * 60_000

function pendente(over: Partial<MensagemPendente> = {}): MensagemPendente {
  return {
    id: 'n1',
    mensagemId: 'EVO1',
    deMim: false,
    tipo: 'texto',
    texto: 'bom dia doutora',
    timestampMs: T0 - DEZ_MIN,
    mediaTamanho: null,
    temMedia: false,
    mediaStoragePath: null,
    mediaFilename: null,
    mediaMimetype: null,
    mediaPendenteMotivo: null,
    recTentativas: 0,
    recDetalhe: null,
    ...over,
  }
}

const criterios: CriteriosElegibilidade = {
  agoraMs: T0,
  idadeMinMs: DEZ_MIN,
  janelaMs: 48 * 3_600_000,
}

const conversaIndividual = {
  tenant_id: TENANT,
  instancia: 'whatsapp-sc',
  jid: '5547991186787@s.whatsapp.net',
  tipo: 'individual' as string | null,
}
const conversaGrupo = {
  tenant_id: TENANT,
  instancia: 'whatsapp-df',
  jid: '120363000000000000@g.us',
  tipo: 'grupo' as string | null,
}

describe('modoReconciliacao — a chave de liga/desliga', () => {
  it('sem env NÃO posta nada (default seguro)', () => {
    expect(modoReconciliacao({})).toBe('off')
    expect(modoReconciliacao({ RECONCILIA_CONVERSAS: '0' })).toBe('off')
    expect(modoReconciliacao({ RECONCILIA_CONVERSAS: 'off' })).toBe('off')
    expect(modoReconciliacao({ RECONCILIA_CONVERSAS: 'talvez' })).toBe('off')
  })

  it('liga completo e modo só-confirmar', () => {
    expect(modoReconciliacao({ RECONCILIA_CONVERSAS: '1' })).toBe('completo')
    expect(modoReconciliacao({ RECONCILIA_CONVERSAS: 'ON' })).toBe('completo')
    expect(modoReconciliacao({ RECONCILIA_CONVERSAS: 'confirmar' })).toBe('confirmar')
  })
})

describe('idadeMinimaMs / janelaMaximaMs', () => {
  it('defaults: 10 min de espera pela ponte nativa, 48h de janela', () => {
    expect(idadeMinimaMs({})).toBe(DEZ_MIN)
    expect(janelaMaximaMs({})).toBe(48 * 3_600_000)
  })

  it('valor inválido ou zero cai no default (nunca postar em cima da ponte)', () => {
    expect(idadeMinimaMs({ RECONCILIA_APOS_MIN: '0' })).toBe(DEZ_MIN)
    expect(idadeMinimaMs({ RECONCILIA_APOS_MIN: 'abc' })).toBe(DEZ_MIN)
    expect(idadeMinimaMs({ RECONCILIA_APOS_MIN: '3' })).toBe(3 * 60_000)
    expect(janelaMaximaMs({ RECONCILIA_JANELA_HORAS: '-1' })).toBe(48 * 3_600_000)
  })
})

describe('elegivelParaPostar', () => {
  it('mensagem nova demais espera a ponte nativa entregar', () => {
    expect(elegivelParaPostar(pendente({ timestampMs: T0 - 60_000 }), criterios)).toBe(false)
    expect(elegivelParaPostar(pendente({ timestampMs: T0 - DEZ_MIN }), criterios)).toBe(true)
  })

  it('mensagem mais velha que a janela fica só no acervo (trava de segurança)', () => {
    expect(elegivelParaPostar(pendente({ timestampMs: T0 - 72 * 3_600_000 }), criterios)).toBe(false)
  })

  it('timestamp no futuro (relógio adiantado) não é elegível', () => {
    expect(elegivelParaPostar(pendente({ timestampMs: T0 + 60_000 }), criterios)).toBe(false)
  })

  it('respeita o teto de tentativas — e o teto próprio do grupo', () => {
    expect(elegivelParaPostar(pendente({ recTentativas: MAX_TENTATIVAS }), criterios)).toBe(false)
    const grupo = { recDetalhe: 'grupo_sem_conversa', recTentativas: MAX_TENTATIVAS }
    expect(elegivelParaPostar(pendente(grupo), criterios)).toBe(true)
    expect(
      elegivelParaPostar(pendente({ ...grupo, recTentativas: TETO_GRUPO_SEM_CONVERSA }), criterios),
    ).toBe(false)
  })

  it('abaixo do piso de cobertura do índice NÃO posta (pode existir lá e duplicar)', () => {
    const m = pendente({ timestampMs: T0 - 3 * 3_600_000 })
    expect(elegivelParaPostar(m, criterios)).toBe(true)
    expect(elegivelParaPostar(m, { ...criterios, coberturaMs: T0 - 3_600_000 })).toBe(false)
    expect(elegivelParaPostar(m, { ...criterios, coberturaMs: T0 - 6 * 3_600_000 })).toBe(true)
  })

  it('mensagem sem texto e sem mídia não vira mensagem no Chatwoot', () => {
    expect(elegivelParaPostar(pendente({ texto: null }), criterios)).toBe(false)
    expect(elegivelParaPostar(pendente({ texto: '   ' }), criterios)).toBe(false)
    expect(temConteudoPostavel({ texto: null, temMedia: true })).toBe(true)
  })
})

describe('tetoTentativas', () => {
  it('grupo_sem_conversa depende do outro lado: teto maior', () => {
    expect(tetoTentativas(null)).toBe(MAX_TENTATIVAS)
    expect(tetoTentativas('contato_nao_criavel')).toBe(MAX_TENTATIVAS)
    expect(tetoTentativas('grupo_sem_conversa')).toBe(TETO_GRUPO_SEM_CONVERSA)
  })
})

describe('ordenarParaPostagem — thread coerente', () => {
  it('posta na ordem do timestamp, com desempate estável pelo id', () => {
    const fora = [
      pendente({ id: 'c', timestampMs: T0 + 2 }),
      pendente({ id: 'b', timestampMs: T0 }),
      pendente({ id: 'a', timestampMs: T0 }),
    ]
    expect(ordenarParaPostagem(fora).map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })

  it('não muda o array original', () => {
    const orig = [pendente({ id: 'z', timestampMs: T0 + 1 }), pendente({ id: 'a', timestampMs: T0 })]
    ordenarParaPostagem(orig)
    expect(orig.map((m) => m.id)).toEqual(['z', 'a'])
  })
})

describe('inboxContrato', () => {
  it('instância da Evolution → inbox do contrato', () => {
    expect(inboxContrato('whatsapp-df')).toBe('df')
    expect(inboxContrato('whatsapp-sc')).toBe('sc')
    expect(inboxContrato('whatsapp-xx')).toBeNull()
  })
})

describe('textoParaPost', () => {
  it('junta a nota ao texto e corta no teto do contrato', () => {
    expect(textoParaPost('segue', NOTA_ANEXO_PERDIDO)).toBe(`segue\n${NOTA_ANEXO_PERDIDO}`)
    expect(textoParaPost(null, NOTA_ANEXO_PERDIDO)).toBe(NOTA_ANEXO_PERDIDO)
    expect(textoParaPost('x'.repeat(LIMITE_TEXTO_POST + 500))).toHaveLength(LIMITE_TEXTO_POST)
  })

  it('sem texto e sem nota é undefined (campo ausente no payload)', () => {
    expect(textoParaPost(null)).toBeUndefined()
    expect(textoParaPost('  ')).toBeUndefined()
  })
})

describe('montarPayload', () => {
  it('individual: telefone só com dígitos, direção e marcador', () => {
    const r = montarPayload(conversaIndividual, pendente())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload).toMatchObject({
      telefone: '5547991186787',
      inbox: 'sc',
      direcao: 'incoming',
      texto: 'bom dia doutora',
      marcador: 'simas-rec:EVO1',
    })
    expect(r.payload.grupoJid).toBeUndefined()
    expect(r.anexoStoragePath).toBeNull()
  })

  it('mensagem nossa vira outgoing', () => {
    const r = montarPayload(conversaIndividual, pendente({ deMim: true }))
    expect(r.ok && r.payload.direcao).toBe('outgoing')
  })

  it('grupo: manda grupoJid e NUNCA telefone (v1 não cria grupo)', () => {
    const r = montarPayload(conversaGrupo, pendente())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.grupoJid).toBe(conversaGrupo.jid)
    expect(r.payload.telefone).toBeUndefined()
    expect(r.payload.inbox).toBe('df')
  })

  it('anexo do nosso Storage vira anexo do contrato', () => {
    const r = montarPayload(
      conversaIndividual,
      pendente({
        tipo: 'documento',
        texto: null,
        temMedia: true,
        mediaStoragePath: `${TENANT}/conversas-acervo/whatsapp-sc/x/EVO1_contrato.pdf`,
        mediaFilename: 'contrato.pdf',
        mediaMimetype: 'application/pdf',
        mediaTamanho: 120_000,
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.anexo).toEqual({ filename: 'contrato.pdf', mimetype: 'application/pdf' })
    expect(r.anexoStoragePath).toContain('conversas-acervo')
    expect(r.payload.texto).toBeUndefined()
  })

  it('mídia pendente vira texto com a nota (a existência da mensagem chega)', () => {
    const r = montarPayload(
      conversaIndividual,
      pendente({ tipo: 'imagem', texto: null, temMedia: true, mediaPendenteMotivo: 'download_falhou' }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.anexo).toBeUndefined()
    expect(r.payload.texto).toBe(NOTA_ANEXO_PERDIDO)
    expect(r.anexoStoragePath).toBeNull()
  })

  it('path de OUTRO tenant nunca é repassado (vale a nota, não o arquivo)', () => {
    const r = montarPayload(
      conversaIndividual,
      pendente({
        tipo: 'documento',
        texto: 'segue',
        temMedia: true,
        mediaStoragePath: '99999999-9999-9999-9999-999999999999/conversas-acervo/x/y.pdf',
        mediaFilename: 'y.pdf',
        mediaMimetype: 'application/pdf',
      }),
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.anexo).toBeUndefined()
    expect(r.payload.texto).toBe(`segue\n${NOTA_ANEXO_PERDIDO}`)
  })

  it('anexo grande demais para o repasse vira nota', () => {
    const r = montarPayload(
      conversaIndividual,
      pendente({
        tipo: 'video',
        texto: null,
        temMedia: true,
        mediaStoragePath: `${TENANT}/conversas-acervo/whatsapp-sc/x/EVO1_v.mp4`,
        mediaFilename: 'v.mp4',
        mediaMimetype: 'video/mp4',
        mediaTamanho: LIMITE_POST_BYTES + 1,
      }),
    )
    expect(r.ok && r.payload.anexo).toBeUndefined()
    expect(r.ok && r.payload.texto).toBe(NOTA_ANEXO_PERDIDO)
  })

  it('recusa instância desconhecida e jid sem telefone', () => {
    expect(montarPayload({ ...conversaIndividual, instancia: 'whatsapp-zz' }, pendente())).toEqual({
      ok: false,
      motivo: 'instancia_desconhecida',
    })
    expect(
      montarPayload({ ...conversaIndividual, jid: '9999@lid' }, pendente()),
    ).toEqual({ ok: false, motivo: 'jid_sem_telefone' })
  })

  it('mensagem vazia não gera payload (o schema barra)', () => {
    const r = montarPayload(conversaIndividual, pendente({ texto: null }))
    expect(r).toEqual({ ok: false, motivo: 'payload_invalido' })
  })
})

describe('payloadReconciliacaoSchema — o contrato das duas pontas', () => {
  const base = {
    inbox: 'sc' as const,
    direcao: 'incoming' as const,
    timestampOriginal: T0,
    marcador: 'simas-rec:EVO1',
    texto: 'oi',
  }

  it('exige telefone OU grupoJid', () => {
    expect(payloadReconciliacaoSchema.safeParse(base).success).toBe(false)
    expect(payloadReconciliacaoSchema.safeParse({ ...base, telefone: '5547991186787' }).success).toBe(true)
    expect(payloadReconciliacaoSchema.safeParse({ ...base, grupoJid: 'x@g.us' }).success).toBe(true)
  })

  it('telefone é só dígitos', () => {
    expect(
      payloadReconciliacaoSchema.safeParse({ ...base, telefone: '+55 (47) 99118-6787' }).success,
    ).toBe(false)
  })

  it('exige texto OU anexo', () => {
    const semConteudo = { ...base, telefone: '5547991186787', texto: undefined }
    expect(payloadReconciliacaoSchema.safeParse(semConteudo).success).toBe(false)
    expect(
      payloadReconciliacaoSchema.safeParse({
        ...semConteudo,
        anexo: { filename: 'a.pdf', mimetype: 'application/pdf' },
      }).success,
    ).toBe(true)
  })
})

describe('interpretarResposta', () => {
  it('200 ok:true = postada, com o id do Chatwoot', () => {
    expect(interpretarResposta(200, { ok: true, chatwootMsgId: 4321 })).toEqual({
      tipo: 'postada',
      chatwootMsgId: '4321',
    })
  })

  it('200 ok:false é caso ESPERADO (não é falha) e vira código curto', () => {
    expect(interpretarResposta(200, { ok: false, motivo: 'grupo_sem_conversa' })).toEqual({
      tipo: 'esperado',
      motivo: 'grupo_sem_conversa',
    })
    expect(interpretarResposta(200, { ok: false, motivo: 'Contato Não Criável!' })).toEqual({
      tipo: 'esperado',
      motivo: 'contato_n_o_cri_vel_',
    })
  })

  it('200 sem ok reconhecível é falha (resposta fora do contrato)', () => {
    expect(interpretarResposta(200, {})).toEqual({ tipo: 'falha', detalhe: 'resposta_invalida' })
  })

  it('4xx é bug nosso de payload; 5xx/502 é erro real do outro lado', () => {
    expect(interpretarResposta(400, {})).toEqual({ tipo: 'falha', detalhe: 'payload_400' })
    expect(interpretarResposta(502, {})).toEqual({ tipo: 'falha', detalhe: 'http_502' })
    expect(interpretarResposta(503, {})).toEqual({ tipo: 'falha', detalhe: 'http_503' })
  })

  it('relay fora do ar/sem config NÃO é falha desta mensagem (não queima tentativa)', () => {
    // O gatilho quente roda a cada lote de eventos: contar tentativa aqui
    // aposentaria mensagens boas em minutos por causa de uma queda de rede.
    expect(interpretarResposta(502, { code: 'RELAY_INDISPONIVEL' })).toEqual({
      tipo: 'indisponivel',
      detalhe: 'relay_indisponivel',
    })
    expect(interpretarResposta(503, { code: 'RELAY_NAO_CONFIGURADO' })).toEqual({
      tipo: 'indisponivel',
      detalhe: 'relay_nao_configurado',
    })
    // 502 do PRÓPRIO relay (Chatwoot fora) continua sendo falha com tentativa.
    expect(interpretarResposta(502, { ok: false, code: 'CHATWOOT_UNREACHABLE' })).toEqual({
      tipo: 'falha',
      detalhe: 'http_502',
    })
  })

  it('429 (teto por minuto da rota) é "agora não", não payload errado', () => {
    expect(interpretarResposta(429, { code: 'RATE_LIMITED' })).toEqual({
      tipo: 'indisponivel',
      detalhe: 'rate_limited',
    })
  })
})

describe('codigoDetalhe — LGPD: só código, nunca conteúdo', () => {
  it('normaliza e limita', () => {
    expect(codigoDetalhe('GRUPO_SEM_CONVERSA', 'x')).toBe('grupo_sem_conversa')
    expect(codigoDetalhe(null, 'padrao')).toBe('padrao')
    expect(codigoDetalhe('a'.repeat(80), 'x')).toHaveLength(40)
  })
})

describe('pendenteDaLinha', () => {
  it('linha do banco → pendente, defensivo com nulos', () => {
    const m = pendenteDaLinha({
      id: 'n1',
      mensagem_id: 'E1',
      de_mim: true,
      tipo: null,
      texto: null,
      media_storage_path: 'x/y',
      media_filename: null,
      media_mimetype: null,
      media_tamanho: null,
      media_pendente_motivo: null,
      timestamp_msg: '2026-07-27T12:00:00.000Z',
      rec_tentativas: null,
      rec_detalhe: null,
    })
    expect(m).toMatchObject({ tipo: 'outro', deMim: true, temMedia: true, recTentativas: 0 })
    expect(m.timestampMs).toBe(T0)
  })
})
