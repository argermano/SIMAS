import { describe, it, expect } from 'vitest'
import {
  arquivoPermitido,
  arquivosDaResposta,
  caminhoArtefato,
  extensaoDe,
  idsDosArtefatos,
  nomeArtefato,
  slugArtefato,
  textoExtraidoDeArtefato,
  tituloArtefato,
  EXTENSOES_ARTEFATO,
  TETO_ARTEFATO_BYTES,
} from './artefatos'

// A política dos ARTEFATOS (F0.5) é o que separa "o agente escreveu um arquivo"
// de "o dossiê do cliente ganhou um documento". Como a materialização é
// AUTOMÁTICA (sem confirmação do advogado), estas três regras são as que
// impedem estrago: a allowlist, o teto e o versionamento por nome lógico.

describe('extensaoDe', () => {
  it('lê a extensão em minúsculas', () => {
    expect(extensaoDe('Calculos.XLSX')).toBe('xlsx')
    expect(extensaoDe('memoria-de-calculo.md')).toBe('md')
  })

  it('nome sem extensão (ou terminado em ponto) não tem extensão', () => {
    expect(extensaoDe('planilha')).toBe('')
    expect(extensaoDe('planilha.')).toBe('')
    expect(extensaoDe('.oculto')).toBe('')
  })

  it('ignora o caminho do sandbox', () => {
    expect(extensaoDe('/tmp/outputs/grafico.png')).toBe('png')
  })
})

describe('arquivoPermitido (allowlist + teto)', () => {
  it('aceita todas as extensões da allowlist', () => {
    for (const ext of EXTENSOES_ARTEFATO) {
      expect(arquivoPermitido({ nome: `arquivo.${ext}`, tamanho: 1024 })).toEqual({ ok: true, ext })
    }
  })

  it('recusa extensão fora da lista (executável, zip, html)', () => {
    for (const nome of ['script.py', 'pacote.zip', 'pagina.html', 'binario.exe', 'sem-extensao']) {
      expect(arquivoPermitido({ nome, tamanho: 1024 })).toMatchObject({ ok: false, motivo: 'extensao' })
    }
  })

  it('recusa arquivo vazio', () => {
    expect(arquivoPermitido({ nome: 'a.csv', tamanho: 0 })).toMatchObject({ ok: false, motivo: 'vazio' })
  })

  it('recusa acima de 25 MB — e aceita exatamente no teto', () => {
    expect(arquivoPermitido({ nome: 'a.pdf', tamanho: TETO_ARTEFATO_BYTES + 1 })).toMatchObject({
      ok: false,
      motivo: 'tamanho',
    })
    expect(arquivoPermitido({ nome: 'a.pdf', tamanho: TETO_ARTEFATO_BYTES }).ok).toBe(true)
  })

  it('recusa nome vazio', () => {
    expect(arquivoPermitido({ nome: '   ', tamanho: 10 })).toMatchObject({ ok: false, motivo: 'sem_nome' })
  })
})

describe('slug / nome (versionamento por NOME LÓGICO)', () => {
  it('tira acento, espaço e caixa: o nome lógico é estável', () => {
    expect(slugArtefato('Cálculos de Rescisão.xlsx')).toBe('calculos-de-rescisao')
    expect(slugArtefato('calculos_de_rescisao.xlsx')).toBe('calculos-de-rescisao')
    expect(slugArtefato('CALCULOS  DE  RESCISAO.xlsx')).toBe('calculos-de-rescisao')
  })

  it('a MESMA planilha regerada em outro formato tem o mesmo nome lógico', () => {
    // Mesmo assunto, extensão diferente: substitui o conteúdo, não duplica a
    // linha do dossiê (o caminho leva a extensão, a chave é o slug).
    expect(slugArtefato('cenarios.xlsx')).toBe(slugArtefato('cenarios.csv'))
  })

  it('assuntos diferentes NÃO colidem', () => {
    expect(slugArtefato('cenario-a.xlsx')).not.toBe(slugArtefato('cenario-b.xlsx'))
  })

  it('nunca fica vazio nem termina em hífen', () => {
    expect(slugArtefato('###.png')).toBe('arquivo')
    expect(slugArtefato('   ')).toBe('arquivo')
    const longo = slugArtefato(`${'planilha-de-calculos-'.repeat(10)}.xlsx`)
    expect(longo.length).toBeLessThanOrEqual(60)
    expect(longo.endsWith('-')).toBe(false)
  })

  it('o rótulo do dossiê identifica a origem', () => {
    expect(tituloArtefato('calculos_rescisao.xlsx')).toBe('calculos rescisao')
    expect(nomeArtefato('Cálculos de Rescisão.xlsx')).toBe('Apoio IA — Cálculos de Rescisão')
  })
})

describe('caminhoArtefato', () => {
  const base = {
    tenantId: 't1',
    clienteId: 'c1',
    atendimentoId: 'a1',
    sessaoId: 's1',
    ext: 'xlsx',
  }

  it('mora na pasta do caso, sob apoio-ia, com prefixo do tenant (RLS do bucket)', () => {
    expect(caminhoArtefato({ ...base, slug: 'cenarios' })).toBe(
      't1/clientes/c1/casos/a1/apoio-ia/s1_cenarios.xlsx',
    )
  })

  it('REGERAR o mesmo nome lógico cai no MESMO caminho (substitui, não duplica)', () => {
    const a = caminhoArtefato({ ...base, slug: slugArtefato('Cálculos de Rescisão.xlsx') })
    const b = caminhoArtefato({ ...base, slug: slugArtefato('calculos de rescisao.xlsx') })
    expect(a).toBe(b)
  })

  it('outra sessão gera outro caminho (versionamento é POR SESSÃO)', () => {
    const a = caminhoArtefato({ ...base, slug: 'cenarios' })
    const b = caminhoArtefato({ ...base, sessaoId: 's2', slug: 'cenarios' })
    expect(a).not.toBe(b)
  })
})

describe('arquivosDaResposta (blocos do code_execution)', () => {
  const blocoOk = (fileIds: string[]) => ({
    type: 'bash_code_execution_tool_result',
    tool_use_id: 'srvtoolu_1',
    content: {
      type: 'bash_code_execution_result',
      stdout: 'ok',
      stderr: '',
      return_code: 0,
      content: fileIds.map((file_id) => ({ type: 'bash_code_execution_output', file_id })),
    },
  })

  it('acha os arquivos criados e conta as execuções', () => {
    const r = arquivosDaResposta([
      { type: 'text', text: '{"resposta_markdown":"..."}' },
      { type: 'server_tool_use', id: 'srvtoolu_1', name: 'code_execution', input: {} },
      blocoOk(['file_1', 'file_2']),
    ])
    expect(r.fileIds).toEqual(['file_1', 'file_2'])
    expect(r.execucoes).toBe(1)
    expect(r.erros).toBe(0)
  })

  it('aceita a forma legada (code_execution_tool_result / code_execution_output)', () => {
    const r = arquivosDaResposta([
      {
        type: 'code_execution_tool_result',
        content: {
          type: 'code_execution_result',
          content: [{ type: 'code_execution_output', file_id: 'file_legado' }],
        },
      },
    ])
    expect(r.fileIds).toEqual(['file_legado'])
  })

  it('execução com erro não vira arquivo — e é contada', () => {
    const r = arquivosDaResposta([
      { type: 'server_tool_use', name: 'code_execution' },
      { type: 'bash_code_execution_tool_result', content: { type: 'bash_code_execution_tool_result_error', error_code: 'execution_time_exceeded' } },
    ])
    expect(r.fileIds).toEqual([])
    expect(r.erros).toBe(1)
    expect(r.execucoes).toBe(1)
  })

  it('não duplica o mesmo file_id citado em duas execuções', () => {
    const r = arquivosDaResposta([blocoOk(['file_1']), blocoOk(['file_1', 'file_3'])])
    expect(r.fileIds).toEqual(['file_1', 'file_3'])
  })

  it('resposta sem ferramenta nenhuma: nada a fazer', () => {
    expect(arquivosDaResposta([{ type: 'text', text: 'oi' }])).toEqual({
      fileIds: [],
      execucoes: 0,
      erros: 0,
    })
    expect(arquivosDaResposta([])).toEqual({ fileIds: [], execucoes: 0, erros: 0 })
  })

  it('ignora lixo (bloco nulo, conteúdo de outro formato)', () => {
    const r = arquivosDaResposta([
      null,
      { type: 'bash_code_execution_tool_result', content: null },
      { type: 'bash_code_execution_tool_result', content: { type: 'bash_code_execution_result', content: [{ type: 'outra_coisa', file_id: 'x' }] } },
    ])
    expect(r.fileIds).toEqual([])
  })
})

describe('textoExtraidoDeArtefato', () => {
  it('CSV e Markdown entram na busca do dossiê', () => {
    expect(textoExtraidoDeArtefato({ ext: 'csv', bytes: Buffer.from('a;b\n1;2') })).toBe('a;b\n1;2')
    expect(textoExtraidoDeArtefato({ ext: 'md', bytes: Buffer.from('# Memória') })).toBe('# Memória')
  })

  it('binários ficam sem texto (não há lib de planilha no projeto)', () => {
    expect(textoExtraidoDeArtefato({ ext: 'xlsx', bytes: Buffer.from([0x50, 0x4b]) })).toBe('')
    expect(textoExtraidoDeArtefato({ ext: 'png', bytes: Buffer.from([0x89, 0x50]) })).toBe('')
  })

  it('corta em 5.000 caracteres (mesmo limite da materialização da peça)', () => {
    const texto = textoExtraidoDeArtefato({ ext: 'csv', bytes: Buffer.from('x'.repeat(9_000)) })
    expect(texto.length).toBe(5_000)
  })
})

describe('idsDosArtefatos', () => {
  it('junta os ids de todos os turnos, sem repetir', () => {
    const ids = idsDosArtefatos([
      { payload: { artefatos: [{ documentoId: 'd1' }, { documentoId: 'd2' }] } },
      { payload: { artefatos: [{ documentoId: 'd1' }] } },
      { payload: { citacoes: {} } },
      { payload: null },
    ])
    expect(ids).toEqual(['d1', 'd2'])
  })
})
