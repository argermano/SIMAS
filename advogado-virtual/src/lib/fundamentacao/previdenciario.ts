import type { TeseCurada } from './tipos'

// Base curada de fundamentação — PREVIDENCIÁRIO.
// Preencha com teses conferidas pelo advogado. O item 'exemplo' abaixo é só um
// TEMPLATE (não é injetado na geração) — copie a estrutura e remova `exemplo`.
export const TESES_PREVIDENCIARIO: TeseCurada[] = [
  {
    id: 'exemplo-prev',
    area: 'previdenciario',
    tese: 'EXEMPLO (não usar) — Enunciado da tese em uma ou duas frases.',
    dispositivos: ['Lei 8.213/91, art. XX', 'CF/88, art. 201'],
    sumulas: [],
    ementas: [
      {
        tribunal: 'STJ',
        processo: 'REsp 0.000.000/UF',
        relator: 'Min. Fulano de Tal',
        julgamento: '01.01.2020',
        ementa: 'Texto integral da ementa, conferido na fonte oficial.',
        fonteUrl: 'https://www.stj.jus.br/...',
        verificadoPor: 'preencher (nome/OAB)',
        verificadoEm: '2026-01-01',
      },
    ],
    quandoUsar: 'Descreva quando esta tese se aplica (tipo de pedido/caso).',
    notas: 'Ressalvas, divergência jurisprudencial, etc.',
    exemplo: true,
  },
]
