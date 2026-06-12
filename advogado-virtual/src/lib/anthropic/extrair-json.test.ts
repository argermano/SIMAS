import { describe, it, expect } from 'vitest'
import { extrairJsonDoTexto } from './client'

// Regressão: modelos mais verbosos (ex.: Opus 4.8 com thinking off) podem envolver
// o JSON em prosa ou cercas de código — o extrator precisa recuperar o JSON puro.
describe('extrairJsonDoTexto', () => {
  it('extrai JSON limpo', () => {
    expect(JSON.parse(extrairJsonDoTexto('{"a":1}'))).toEqual({ a: 1 })
  })

  it('ignora prosa antes e depois', () => {
    const t = 'Claro! Aqui está a análise:\n{"urgencia":"alta","ok":true}\nEspero ter ajudado.'
    expect(JSON.parse(extrairJsonDoTexto(t))).toEqual({ urgencia: 'alta', ok: true })
  })

  it('remove cercas ```json', () => {
    const t = '```json\n{"x":[1,2,3]}\n```'
    expect(JSON.parse(extrairJsonDoTexto(t))).toEqual({ x: [1, 2, 3] })
  })

  it('remove cercas ``` sem rótulo', () => {
    const t = 'resultado:\n```\n{"y":"z"}\n```'
    expect(JSON.parse(extrairJsonDoTexto(t))).toEqual({ y: 'z' })
  })

  it('respeita chaves dentro de strings', () => {
    const t = 'texto {"msg":"use { e } com cuidado","n":2} fim'
    expect(JSON.parse(extrairJsonDoTexto(t))).toEqual({ msg: 'use { e } com cuidado', n: 2 })
  })

  it('lida com objeto aninhado e prosa final com chaves', () => {
    const t = '{"a":{"b":1}} — observação: {não é json}'
    expect(JSON.parse(extrairJsonDoTexto(t))).toEqual({ a: { b: 1 } })
  })

  it('extrai array no topo', () => {
    expect(JSON.parse(extrairJsonDoTexto('Itens: [1,2,{"a":3}] pronto'))).toEqual([1, 2, { a: 3 }])
  })
})
