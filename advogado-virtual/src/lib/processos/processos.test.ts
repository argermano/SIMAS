import { describe, it, expect } from 'vitest'
import { classificarMovimento, sugereEncerramento, CATEGORIAS_NOTIFICAVEIS_DEFAULT } from './categorias'
import { hashMovimento } from './sync'
import { datajudDataParaISO } from '@/lib/jurisprudencia/datajud'
import { validarNumeroCNJ, aliasDataJud } from '@/lib/jurisprudencia/verificador-citacoes'

describe('categorias — classificação de movimentos (TPU + nome)', () => {
  it('classifica trânsito em julgado (por código e por nome)', () => {
    expect(classificarMovimento({ codigo: 848, nome: 'qualquer coisa' })).toBe('transito_julgado')
    expect(classificarMovimento({ codigo: null, nome: 'Trânsito em Julgado' })).toBe('transito_julgado')
  })

  it('classifica sentença / procedência / homologação', () => {
    expect(classificarMovimento({ nome: 'Procedência' })).toBe('sentenca')
    expect(classificarMovimento({ nome: 'Julgamento com Resolução do Mérito - Improcedência' })).toBe('sentenca')
    expect(classificarMovimento({ nome: 'Homologação de Transação' })).toBe('sentenca')
  })

  it('distingue arquivamento definitivo (encerra) de provisório (comum)', () => {
    expect(classificarMovimento({ nome: 'Arquivamento Definitivo' })).toBe('arquivamento')
    expect(classificarMovimento({ codigo: 246, nome: 'Definitivo' })).toBe('arquivamento')
    expect(classificarMovimento({ nome: 'Arquivamento Provisório' })).toBe('movimentacao_comum')
    expect(sugereEncerramento('arquivamento')).toBe(true)
    expect(sugereEncerramento('movimentacao_comum')).toBe(false)
  })

  it('detecta alvará no complemento de "Expedição de documento"', () => {
    expect(
      classificarMovimento({
        nome: 'Expedição de documento',
        complementos: [{ nome: 'tipo_de_documento', descricao: 'Alvará' }],
      }),
    ).toBe('expedicao_alvara')
  })

  it('classifica recurso e audiência', () => {
    expect(classificarMovimento({ nome: 'Recebido o Recurso de Apelação' })).toBe('recurso')
    expect(classificarMovimento({ nome: 'Audiência de Conciliação Designada' })).toBe('audiencia')
  })

  it('cai em movimentação comum e retorna null quando nada casa', () => {
    expect(classificarMovimento({ nome: 'Juntada de Petição' })).toBe('movimentacao_comum')
    expect(classificarMovimento({ nome: 'Conclusão para Despacho' })).toBe('movimentacao_comum')
    expect(classificarMovimento({ nome: 'xyzzy termo inexistente' })).toBeNull()
  })

  it('defaults notificáveis incluem sentença/trânsito/audiência/alvará/recurso/arquivamento', () => {
    expect(CATEGORIAS_NOTIFICAVEIS_DEFAULT).toEqual(
      expect.arrayContaining(['sentenca', 'transito_julgado', 'audiencia', 'expedicao_alvara', 'recurso', 'arquivamento']),
    )
    expect(CATEGORIAS_NOTIFICAVEIS_DEFAULT).not.toContain('movimentacao_comum')
    expect(CATEGORIAS_NOTIFICAVEIS_DEFAULT).not.toContain('decisao_despacho')
  })
})

describe('sync — hash de movimento (dedup)', () => {
  it('mesmo registro → mesmo hash; registro diferente → hash diferente', () => {
    const a = { codigo: 60, nome: 'Expedição de documento', dataHora: '2026-03-11T10:00:00' }
    const b = { ...a }
    const c = { ...a, dataHora: '2026-03-12T10:00:00' }
    expect(hashMovimento(a)).toBe(hashMovimento(b))
    expect(hashMovimento(a)).not.toBe(hashMovimento(c))
    expect(hashMovimento(a)).toHaveLength(32) // md5 hex
  })
})

describe('datajud — normalização de datas', () => {
  it('mantém ISO e converte o formato compacto AAAAMMDDHHmmss', () => {
    expect(datajudDataParaISO('2026-06-10T02:22:33.000Z')).toBe('2026-06-10T02:22:33.000Z')
    expect(datajudDataParaISO('20250730161039')).toBe('2025-07-30T16:10:39')
    expect(datajudDataParaISO('20250730')).toBe('2025-07-30')
    expect(datajudDataParaISO(null)).toBeNull()
    expect(datajudDataParaISO('')).toBeNull()
    expect(datajudDataParaISO(12345)).toBeNull()
  })
})

describe('CNJ — validação e alias (caso Marta)', () => {
  it('valida o número da Marta e mapeia para TJPR (8.16), não TJSC', () => {
    const marta = '0009008-28.2025.8.16.0026'
    expect(validarNumeroCNJ(marta)).toBe(true)
    expect(aliasDataJud(marta)).toBe('tjpr')
  })

  it('rejeita número com DV inválido', () => {
    expect(validarNumeroCNJ('0009008-99.2025.8.16.0026')).toBe(false)
  })
})
