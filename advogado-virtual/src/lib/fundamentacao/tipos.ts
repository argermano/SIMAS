// Base curada de fundamentação (B5.3) — ATIVO EDITORIAL versionado no repo.
//
// Regra de ouro: NADA entra aqui sem conferência humana. Ementa exige fonteUrl
// + verificadoPor. NUNCA preencher por IA — o modelo pode citar da base
// LITERALMENTE (sem [VERIFICAR]), então lixo aqui vira alucinação com selo de
// verdade. O conteúdo real é curadoria do dono do produto (advogado).

export interface EmentaCurada {
  tribunal: string        // ex.: 'STJ'
  processo: string        // ex.: 'REsp 1.657.156/RJ'
  relator: string         // ex.: 'Min. Benedito Gonçalves'
  julgamento: string      // ex.: '25.04.2018' (data do julgamento)
  ementa: string          // TEXTO da ementa/tese, conferido na fonte
  fonteUrl: string        // link para a decisão na fonte oficial
  verificadoPor: string   // quem conferiu (nome/OAB)
  verificadoEm: string    // AAAA-MM-DD
}

export interface TeseCurada {
  id: string              // slug estável, ex.: 'prev-tempo-especial-ruido'
  area: string            // id da área (previdenciario, civel, ...)
  tese: string            // enunciado da tese em 1-2 frases
  dispositivos: string[]  // ex.: ['Lei 8.213/91, art. 57', 'CF/88, art. 201']
  sumulas: string[]       // ex.: ['Súmula 198 do TFR'] — só verificadas
  ementas: EmentaCurada[] // 0..3 por tese; SÓ com verificação humana
  quandoUsar: string      // gatilhos (tipo de caso/pedido) para seleção
  notas?: string          // ressalvas, divergência jurisprudencial
  /** true = registro de EXEMPLO/template: aparece na biblioteca, NÃO é injetado na geração. */
  exemplo?: boolean
}
