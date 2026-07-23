import { describe, it, expect } from 'vitest'
import {
  classificarAcaoTarefa,
  detectarTipoPeca,
  resolverPecaAlvo,
  construirHref,
  contextoAlvoDaTask,
  tituloNaoTrivial,
  type AlvoContexto,
} from './acao'

// Helper: parseia o href e devolve pathname + params (robusto a ordem/encoding).
function partes(href: string) {
  const u = new URL(href, 'https://x')
  return { path: u.pathname, params: Object.fromEntries(u.searchParams) }
}

describe('classificarAcaoTarefa — títulos reais (exports do Astrea)', () => {
  it('peça: "PARTE x PARTE: <peça>. PUB dd/mm"', () => {
    expect(classificarAcaoTarefa('MARIA SILVA x INSS: APELAÇÃO. PUB 12/03')).toBe('peca')
    expect(classificarAcaoTarefa('JOÃO x EMPRESA LTDA: CONTRARRAZÕES. PUB 03/04')).toBe('peca')
    expect(classificarAcaoTarefa('CICLANO x BANCO: E.D. PUB 15/02')).toBe('peca')
    expect(classificarAcaoTarefa('FULANO x MUNICÍPIO: EMENDA. PUB 20/01')).toBe('peca')
    expect(classificarAcaoTarefa('BELTRANO x INSS: MANIFESTAR. PUB 10/05')).toBe('peca')
    expect(classificarAcaoTarefa('ré x autor: CONTESTAÇÃO')).toBe('peca')
    expect(classificarAcaoTarefa('cliente x parte: ALEGAÇÕES FINAIS')).toBe('peca')
  })

  it('agendamento: contato/compromisso', () => {
    expect(classificarAcaoTarefa('AGENDAR PERÍCIA MÉDICA')).toBe('agendamento')
    expect(classificarAcaoTarefa('LIGAÇÃO COM JOÃO SOBRE O CASO')).toBe('agendamento')
    expect(classificarAcaoTarefa('LIGAR PARA CLIENTE')).toBe('agendamento')
    expect(classificarAcaoTarefa('REUNIÃO COM A PARTE CONTRÁRIA')).toBe('agendamento')
    expect(classificarAcaoTarefa('AGENDAR ENTREVISTA')).toBe('agendamento')
  })

  it('documento: juntada/arquivos', () => {
    expect(classificarAcaoTarefa('JUNTAR COMPROVANTES DE RESIDÊNCIA')).toBe('documento')
    expect(classificarAcaoTarefa('ESCANEAR RG E CPF')).toBe('documento')
    expect(classificarAcaoTarefa('JUNTAR DOCUMENTAÇÃO DO CLIENTE')).toBe('documento')
    expect(classificarAcaoTarefa('DIGITALIZAR PROCURAÇÃO')).toBe('documento')
    expect(classificarAcaoTarefa('ANEXAR COMPROVANTE DE PAGAMENTO')).toBe('documento')
  })

  it('processo: atos/verificações', () => {
    expect(classificarAcaoTarefa('RETIRAR RPV NO FÓRUM')).toBe('processo')
    expect(classificarAcaoTarefa('CONFERIR SE FOI PUBLICADO')).toBe('processo')
    expect(classificarAcaoTarefa('ACOMPANHAR ANDAMENTO DO PROCESSO')).toBe('processo')
    expect(classificarAcaoTarefa('VERIFICAR INTIMAÇÃO')).toBe('processo')
  })

  it('indefinido quando nada casa / vazio', () => {
    expect(classificarAcaoTarefa('')).toBe('indefinido')
    expect(classificarAcaoTarefa('   ')).toBe('indefinido')
    expect(classificarAcaoTarefa('assunto pendente do cliente')).toBe('indefinido')
  })

  it('precedência: agendamento vence peça quando há verbo de contato', () => {
    expect(classificarAcaoTarefa('LIGAR PARA CLIENTE SOBRE A APELAÇÃO')).toBe('agendamento')
  })

  it('precedência: peça vence processo quando há substantivo de peça', () => {
    // "PROTOCOLAR APELAÇÃO" — favorecemos abrir o motor de peças.
    expect(classificarAcaoTarefa('PROTOCOLAR APELAÇÃO')).toBe('peca')
  })

  it('E.D. só casa o token real de embargos (não "…e. d…" no meio da frase)', () => {
    expect(classificarAcaoTarefa('CICLANO x BANCO: E.D. PUB 15/02')).toBe('peca')
    expect(classificarAcaoTarefa('OPOR E.D')).toBe('peca')
    // "cliente. digitalizar" não pode virar peça por casar "e. d".
    expect(classificarAcaoTarefa('VER CLIENTE. DIGITALIZAR RG')).toBe('documento')
    expect(classificarAcaoTarefa('AVISAR CLIENTE. DEPOIS ARQUIVAR')).toBe('indefinido')
  })
})

describe('detectarTipoPeca', () => {
  it('mapeia os tipos comuns', () => {
    expect(detectarTipoPeca('X x Y: APELAÇÃO. PUB 1/1')).toBe('apelacao')
    expect(detectarTipoPeca('CONTRARRAZÕES ao recurso')).toBe('contrarrazoes')
    expect(detectarTipoPeca('E.D. contra a sentença')).toBe('embargos')
    expect(detectarTipoPeca('EMBARGOS DE DECLARAÇÃO')).toBe('embargos')
    expect(detectarTipoPeca('CONTESTAÇÃO')).toBe('contestacao')
    expect(detectarTipoPeca('RÉPLICA à contestação')).toBe('replica')
    expect(detectarTipoPeca('RECURSO ESPECIAL')).toBe('recurso_especial')
    expect(detectarTipoPeca('PETIÇÃO INICIAL')).toBe('peticao_inicial')
    expect(detectarTipoPeca('ALEGAÇÕES FINAIS')).toBe('alegacoes_finais')
  })

  it('devolve null para peças sem tipo no catálogo (emenda/manifestação)', () => {
    expect(detectarTipoPeca('EMENDA')).toBeNull()
    expect(detectarTipoPeca('MANIFESTAR sobre o laudo')).toBeNull()
    expect(detectarTipoPeca('IMPUGNAÇÃO')).toBeNull()
  })
})

describe('resolverPecaAlvo', () => {
  it('usa o tipo detectado quando pertence à área', () => {
    expect(resolverPecaAlvo('APELAÇÃO. PUB 1/1', 'previdenciario')).toEqual({ tipoPeca: 'apelacao', nome: null })
  })

  it('cai em "outra" com nome legível quando o tipo não serve à área', () => {
    // trabalhista NÃO tem 'recurso_especial' na lista de peças.
    const r = resolverPecaAlvo('RECURSO ESPECIAL', 'trabalhista')
    expect(r.tipoPeca).toBe('outra')
    expect(r.nome).toBe('Recurso Especial')
  })

  it('deriva o nome do título quando o tipo é null (manifestação)', () => {
    const r = resolverPecaAlvo('BELTRANO x INSS: MANIFESTAR. PUB 10/05', 'previdenciario')
    expect(r.tipoPeca).toBe('outra')
    expect(r.nome).toBe('MANIFESTAR')
  })
})

describe('construirHref', () => {
  const base: AlvoContexto = {
    titulo: '', dueDate: null, atendimentoId: null, area: null,
    clienteId: null, clienteNome: null, processoId: null,
  }

  it('peça → motor de peças do atendimento, no tipo certo', () => {
    const { path, params } = partes(construirHref('peca', {
      ...base, titulo: 'X x INSS: APELAÇÃO. PUB 1/1', atendimentoId: 'at1', area: 'previdenciario',
    })!)
    expect(path).toBe('/previdenciario/pecas/apelacao')
    expect(params.id).toBe('at1')
  })

  it('peça → slug "outra" com nome quando o tipo não é do catálogo', () => {
    const { path, params } = partes(construirHref('peca', {
      ...base, titulo: 'EMENDA', atendimentoId: 'at2', area: 'previdenciario',
    })!)
    expect(path).toBe('/previdenciario/pecas/outra')
    expect(params.id).toBe('at2')
    expect(params.nome).toBe('EMENDA')
  })

  it('peça sem atendimento cai no cliente (se houver)', () => {
    expect(construirHref('peca', { ...base, titulo: 'APELAÇÃO', clienteId: 'c9' })).toBe('/clientes/c9')
    expect(construirHref('peca', { ...base, titulo: 'APELAÇÃO' })).toBeNull()
  })

  it('agendamento → /agenda?novo=1 com prefill (título, data, cliente)', () => {
    const { path, params } = partes(construirHref('agendamento', {
      ...base, titulo: 'LIGAÇÃO COM JOÃO', dueDate: '2026-07-31T00:00:00.000Z',
      clienteId: 'c1', clienteNome: 'João',
    })!)
    expect(path).toBe('/agenda')
    expect(params.novo).toBe('1')
    expect(params.titulo).toBe('LIGAÇÃO COM JOÃO')
    expect(params.data).toBe('2026-07-31')
    expect(params.clienteId).toBe('c1')
    expect(params.clienteNome).toBe('João')
  })

  it('agendamento sem vencimento não inclui data', () => {
    const { params } = partes(construirHref('agendamento', { ...base, titulo: 'AGENDAR PERÍCIA' })!)
    expect(params.data).toBeUndefined()
    expect(params.titulo).toBe('AGENDAR PERÍCIA')
  })

  it('documento/processo → dossiê do cliente (ou null sem cliente)', () => {
    expect(construirHref('documento', { ...base, clienteId: 'c2' })).toBe('/clientes/c2')
    expect(construirHref('documento', { ...base })).toBeNull()
    expect(construirHref('processo', { ...base, clienteId: 'c3' })).toBe('/clientes/c3')
  })
})

describe('contextoAlvoDaTask', () => {
  it('vínculo de atendimento: extrai atendimentoId + área + cliente do caso', () => {
    const ctx = contextoAlvoDaTask({
      description: 'APELAÇÃO',
      due_date: '2026-08-01',
      process_id: 'at1',
      atendimentos: { id: 'at1', area: 'previdenciario', clientes: { id: 'c1', nome: 'Maria' } },
    })
    expect(ctx).toMatchObject({
      titulo: 'APELAÇÃO', dueDate: '2026-08-01', atendimentoId: 'at1',
      area: 'previdenciario', clienteId: 'c1', clienteNome: 'Maria',
    })
  })

  it('vínculo de cliente direto', () => {
    const ctx = contextoAlvoDaTask({
      description: 'JUNTAR RG', cliente_id: 'c5', cliente: { id: 'c5', nome: 'Ana' },
    })
    expect(ctx.clienteId).toBe('c5')
    expect(ctx.clienteNome).toBe('Ana')
    expect(ctx.atendimentoId).toBeNull()
  })

  it('vínculo de processo: usa o cliente do processo', () => {
    const ctx = contextoAlvoDaTask({
      description: 'CONFERIR ANDAMENTO', processo_id: 'p1',
      processo: { id: 'p1', clientes: [{ id: 'c7', nome: 'Rui' }] },
    })
    expect(ctx.processoId).toBe('p1')
    expect(ctx.clienteId).toBe('c7')
    expect(ctx.clienteNome).toBe('Rui')
  })

  it('sem vínculo: tudo null (menos título/vencimento)', () => {
    const ctx = contextoAlvoDaTask({ description: 'assunto', due_date: null })
    expect(ctx.atendimentoId).toBeNull()
    expect(ctx.clienteId).toBeNull()
    expect(ctx.area).toBeNull()
  })
})

describe('tituloNaoTrivial', () => {
  it('true para títulos com ≥2 palavras e ≥8 chars', () => {
    expect(tituloNaoTrivial('assunto pendente do cliente')).toBe(true)
  })
  it('false para vazio/uma palavra/curto', () => {
    expect(tituloNaoTrivial('')).toBe(false)
    expect(tituloNaoTrivial('rpv')).toBe(false)
    expect(tituloNaoTrivial('ver rpv')).toBe(false) // 7 chars alfanuméricos
  })
})
