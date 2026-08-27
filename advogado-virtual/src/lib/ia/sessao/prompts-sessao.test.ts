import { describe, it, expect } from 'vitest'
import { montarSystemSessao, SYSTEM_SESSAO } from './prompts'
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
