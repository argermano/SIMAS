import { describe, it, expect } from 'vitest'
import { montarSystemSessao, SYSTEM_ARTEFATOS, SYSTEM_SESSAO } from './prompts'
import { ESQUEMA_ENVELOPE } from './envelope'
import { ANTI_INJECTION } from '@/lib/anthropic/client'
import { SYSTEM_MODO_REFINAR } from '@/lib/prompts/pecas/_shared/modo-refinar'
import { PROMPT_MAP } from '@/lib/ia/pecas/registro-pecas'
import type { ContextoPeca } from '@/lib/ia/pecas/contexto'

// Snapshots da COMPOSIÇÃO do system da sessão de lapidação (F0.3). Os 40
// snapshots dos prompts curados (prompts-snapshot.test.ts) e os 10 dos modos
// (modos-snapshot.test.ts) NÃO mudam: aqui travamos só o texto novo
// (SYSTEM_SESSAO) e a ordem em que ele se junta ao que já existia.

function ctxFake(over: Partial<ContextoPeca['meta']> = {}): ContextoPeca {
  return {
    system: 'SYSTEM CURADO DA ÁREA (fixture)',
    promptBase: '',
    documentosContexto: [],
    meta: {
      atendimentoId: 'at-1',
      area: 'previdenciario',
      tipo: 'peticao_inicial',
      curado: true,
      qualificacao: { autor: { nome: 'João da Silva' } },
      localizacao: {},
      modeloPadrao: null,
      jurisprudenciaTexto: '',
      blocoFundamentacao: '',
      totalDocumentos: 0,
      documentosRelevantes: 0,
      triagemAplicada: false,
      ...over,
    },
  }
}

describe('SYSTEM_SESSAO', () => {
  it('texto estável', () => {
    expect(SYSTEM_SESSAO).toMatchSnapshot('system-sessao')
  })

  it('diz as regras duras da sessão', () => {
    expect(SYSTEM_SESSAO).toContain('NUNCA reescreva a peça inteira')
    expect(SYSTEM_SESSAO).toContain('[VERIFICAR]')
    expect(SYSTEM_SESSAO).toContain('PATCH POR SEÇÃO')
  })
})

describe('SYSTEM_ARTEFATOS (F0.5 — cálculos no sandbox)', () => {
  it('texto estável', () => {
    expect(SYSTEM_ARTEFATOS).toMatchSnapshot('system-artefatos')
  })

  it('diz as regras que o dossiê depende', () => {
    // O nome do arquivo é a CHAVE do versionamento (regerar substitui) e o
    // rótulo que o escritório vê na pasta do caso.
    expect(SYSTEM_ARTEFATOS).toContain('NOME DESCRITIVO EM PORTUGUÊS')
    expect(SYSTEM_ARTEFATOS).toContain('SUBSTITUI a versão anterior')
    expect(SYSTEM_ARTEFATOS).toContain('anexado AUTOMATICAMENTE ao dossiê')
    for (const ext of ['.xlsx', '.csv', '.docx', '.pdf', '.md', '.png']) {
      expect(SYSTEM_ARTEFATOS).toContain(ext)
    }
  })
})

describe('montarSystemSessao', () => {
  it('com prompt curado: curado + modo refinar + sessão, nessa ordem', () => {
    const ctx = ctxFake()
    const system = montarSystemSessao(ctx)
    expect(system).toBe(`${ctx.system}\n\n${SYSTEM_MODO_REFINAR}\n\n${SYSTEM_SESSAO}`)
    expect(system.indexOf(ctx.system)).toBeLessThan(system.indexOf(SYSTEM_MODO_REFINAR))
    expect(system.indexOf(SYSTEM_MODO_REFINAR)).toBeLessThan(system.indexOf(SYSTEM_SESSAO))
  })

  it('sem prompt curado (peça colada de fora): modo refinar + sessão', () => {
    expect(montarSystemSessao(ctxFake({ curado: false }))).toBe(`${SYSTEM_MODO_REFINAR}\n\n${SYSTEM_SESSAO}`)
    expect(montarSystemSessao(null)).toBe(`${SYSTEM_MODO_REFINAR}\n\n${SYSTEM_SESSAO}`)
  })

  it('composição completa estável (a que o modelo recebe, já com o guardrail do client)', () => {
    expect(montarSystemSessao(ctxFake()) + ANTI_INJECTION).toMatchSnapshot('composicao-com-guardrail')
  })

  it('com artefatos: o bloco do sandbox entra POR ÚLTIMO e não muda o resto', () => {
    const sem = montarSystemSessao(ctxFake())
    const com = montarSystemSessao(ctxFake(), { artefatos: true })
    // O prefixo é byte a byte o mesmo — o cache de prompt da sessão depende disso.
    expect(com).toBe(`${sem}\n\n${SYSTEM_ARTEFATOS}`)
    expect(com.startsWith(sem)).toBe(true)
  })

  it('sem opções: composição idêntica à da F0.3 (nenhum snapshot antigo muda)', () => {
    expect(montarSystemSessao(ctxFake(), {})).toBe(montarSystemSessao(ctxFake()))
    expect(montarSystemSessao(ctxFake(), { artefatos: false })).toBe(montarSystemSessao(ctxFake()))
  })

  it('composição com artefatos estável (snapshot NOVO — os anteriores intactos)', () => {
    expect(montarSystemSessao(ctxFake(), { artefatos: true }) + ANTI_INJECTION).toMatchSnapshot(
      'composicao-com-artefatos',
    )
  })

  it('NÃO duplica o guardrail (quem o acrescenta é o client de IA)', () => {
    expect(montarSystemSessao(ctxFake())).not.toContain('SEGURANÇA (PRIORIDADE MÁXIMA)')
  })

  it('o prompt curado entra byte a byte (nenhum caractere alterado)', () => {
    const curado = PROMPT_MAP.previdenciario.peticao_inicial.system
    const ctx = { ...ctxFake(), system: curado }
    expect(montarSystemSessao(ctx).startsWith(curado)).toBe(true)
  })
})

describe('ESQUEMA_ENVELOPE (structured output)', () => {
  it('schema estável', () => {
    expect(ESQUEMA_ENVELOPE).toMatchSnapshot('esquema')
  })

  it('resposta_markdown é a PRIMEIRA propriedade (transmissão ao vivo depende disso)', () => {
    expect(Object.keys(ESQUEMA_ENVELOPE.properties)[0]).toBe('resposta_markdown')
  })

  it('só resposta_markdown é obrigatória — resposta de conversa não tem proposta', () => {
    expect(ESQUEMA_ENVELOPE.required).toEqual(['resposta_markdown'])
  })
})
