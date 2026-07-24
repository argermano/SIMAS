import { describe, it, expect } from 'vitest'
import {
  resolverPreferencias,
  podarParaGravar,
  preferenciasEfetivas,
  CATALOGO_NOTIFICACOES,
  type TipoNotificacao,
} from './catalogo'

describe('resolverPreferencias — defaults do catálogo', () => {
  it('null/undefined → default de cada tipo', () => {
    expect(resolverPreferencias(null, 'tarefa_atribuida')).toEqual({ email: true, whatsapp: true })
    expect(resolverPreferencias(undefined, 'tarefa_comentario')).toEqual({ email: false, whatsapp: false })
    expect(resolverPreferencias(null, 'resumo_diario')).toEqual({ email: false, whatsapp: true })
  })

  it('objeto sem o tipo → default', () => {
    expect(resolverPreferencias({ outro: { email: true } }, 'resumo_diario')).toEqual({
      email: false,
      whatsapp: true,
    })
  })
})

describe('resolverPreferencias — override parcial', () => {
  it('sobrescreve só o canal informado; o outro cai no default', () => {
    // resumo_diario default = {email:false, whatsapp:true}; liga e-mail, omite whatsapp
    expect(resolverPreferencias({ resumo_diario: { email: true } }, 'resumo_diario')).toEqual({
      email: true,
      whatsapp: true,
    })
    // desliga whatsapp explicitamente
    expect(resolverPreferencias({ resumo_diario: { whatsapp: false } }, 'resumo_diario')).toEqual({
      email: false,
      whatsapp: false,
    })
  })

  it('valores não-booleanos são ignorados (caem no default)', () => {
    expect(
      resolverPreferencias({ tarefa_atribuida: { email: 'sim', whatsapp: 0 } }, 'tarefa_atribuida'),
    ).toEqual({ email: true, whatsapp: true })
  })
})

describe('resolverPreferencias — tipo desconhecido', () => {
  it('nunca envia por engano (tudo false)', () => {
    expect(resolverPreferencias(null, 'inexistente' as unknown as TipoNotificacao)).toEqual({
      email: false,
      whatsapp: false,
    })
    expect(
      resolverPreferencias({ inexistente: { email: true, whatsapp: true } }, 'inexistente' as unknown as TipoNotificacao),
    ).toEqual({ email: false, whatsapp: false })
  })
})

describe('podarParaGravar — só grava o que difere do default', () => {
  it('tudo igual ao default → null (coluna volta a NULL)', () => {
    const efetivo = preferenciasEfetivas(null) // todos nos defaults
    expect(podarParaGravar(efetivo)).toBeNull()
  })

  it('mantém apenas os tipos alterados', () => {
    const escolhido = preferenciasEfetivas(null)
    escolhido.resumo_diario = { email: false, whatsapp: false } // difere do default {false,true}
    expect(podarParaGravar(escolhido)).toEqual({
      resumo_diario: { email: false, whatsapp: false },
    })
  })

  it('roundtrip: podar → resolver reconstrói a escolha do usuário', () => {
    const escolhido = preferenciasEfetivas(null)
    escolhido.tarefa_atribuida = { email: true, whatsapp: false }
    const gravado = podarParaGravar(escolhido)
    expect(resolverPreferencias(gravado, 'tarefa_atribuida')).toEqual({ email: true, whatsapp: false })
    // um tipo intocado continua no default
    expect(resolverPreferencias(gravado, 'resumo_diario')).toEqual(
      CATALOGO_NOTIFICACOES.resumo_diario.default,
    )
  })
})
