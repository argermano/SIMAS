import { describe, it, expect } from 'vitest'
import { montarTextoAvisoParcela } from './aviso'

describe('montarTextoAvisoParcela — aviso WhatsApp de parcela', () => {
  const base = {
    nomeCliente: 'maria APARECIDA souza',
    descricao: 'Honorários — parcela 2/10',
    valorCentavos: 50000,
    vencimentoISO: '2026-07-14',
    escritorioNome: 'Simas Advocacia',
    ehHoje: false,
  }

  it('D-3: saudação com primeiro nome, data dd/mm/yyyy, valor formatado e fecho padrão', () => {
    const texto = montarTextoAvisoParcela(base)
    expect(texto).toContain('Olá, Maria!')
    expect(texto).toContain('vence em 14/07/2026')
    expect(texto).toContain('Honorários — parcela 2/10 — R$ 500,00')
    expect(texto).toContain('Se tiver qualquer dúvida, é só responder por aqui que a gente te ajuda. 🙂')
    expect(texto).toContain('— Equipe Simas Advocacia')
    expect(texto).not.toContain('Pix')
  })

  it('D-0: fala "vence hoje" com a data', () => {
    const texto = montarTextoAvisoParcela({ ...base, ehHoje: true })
    expect(texto).toContain('vence hoje (14/07/2026)')
  })

  it('inclui o Pix copia e cola quando configurado', () => {
    const pix = '00020126330014br.gov.bcb.pix0111a@b.com...'
    const texto = montarTextoAvisoParcela({ ...base, pixCopiaECola: pix })
    expect(texto).toContain('Pix copia e cola')
    expect(texto).toContain(pix)
  })

  it('sem nome e sem escritório: saudação genérica e assinatura padrão', () => {
    const texto = montarTextoAvisoParcela({ ...base, nomeCliente: null, escritorioNome: null })
    expect(texto).toContain('Olá!')
    expect(texto).toContain('— Equipe do escritório')
  })
})
