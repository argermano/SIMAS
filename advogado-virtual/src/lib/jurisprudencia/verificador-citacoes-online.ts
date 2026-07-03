/**
 * Camada ONLINE do verificador de citações (B5.2 — incremento).
 *
 * Parte do resultado determinístico (verificarCitacoes) e ENRIQUECE com fontes
 * públicas, elevando ⚠ "conferir" para ✓/✗ quando há confirmação:
 * - Lei fora da base local  → LexML (existência da norma federal)
 * - Processo com dígito CNJ válido → DataJud (existência pelo número exato)
 *
 * Só sobe a régua com segurança: fontes online confirmam (✓) ou refinam a
 * mensagem; nunca criam um ✗ a partir de erro/timeout (degradam para o status
 * determinístico anterior). O ✗ "duro" continua vindo das checagens
 * determinísticas (dígito verificador inválido, súmula fora de faixa).
 */

import {
  verificarCitacoes,
  urnLexmlDaLei,
  aliasDataJud,
  type RelatorioCitacoes,
  type CitacaoVerificada,
} from './verificador-citacoes'
import { normaExisteNoLexml } from './lexml'
import { contarProcessoExato } from './datajud'

// Teto de consultas externas por peça (evita rajada numa peça com dezenas de
// citações; o excedente mantém o status determinístico).
const MAX_CONSULTAS_ONLINE = 25

export async function verificarCitacoesOnline(texto: string): Promise<RelatorioCitacoes> {
  const base = verificarCitacoes(texto)
  let orcamento = MAX_CONSULTAS_ONLINE

  const itens = await Promise.all(
    base.itens.map(async (c): Promise<CitacaoVerificada> => {
      // Lei fora da base local → confirma no LexML.
      if (c.tipo === 'lei' && c.status === 'conferir' && orcamento > 0) {
        orcamento--
        const urn = urnLexmlDaLei(c.texto)
        if (!urn) return c
        const existe = await normaExisteNoLexml(urn)
        if (existe === true) {
          return { ...c, status: 'verificada', detalhe: 'confirmada na base federal do LexML' }
        }
        if (existe === false) {
          return {
            ...c,
            status: 'nao_verificada',
            detalhe: 'não localizada na base federal do LexML — confirme (se for estadual/municipal, desconsidere este alerta)',
          }
        }
        return c // inconclusivo → mantém "conferir"
      }

      // Processo com dígito verificador válido → confirma existência no DataJud.
      if (c.tipo === 'processo' && c.status === 'verificada' && orcamento > 0) {
        orcamento--
        const numero = c.texto.replace(/\D/g, '')
        const alias = aliasDataJud(numero)
        if (!alias) {
          return { ...c, detalhe: 'nº CNJ com dígito válido — tribunal fora da cobertura de verificação online (confirme)' }
        }
        const total = await contarProcessoExato(alias, numero)
        if (total === null) {
          return { ...c, detalhe: 'nº CNJ com dígito válido — não foi possível confirmar no DataJud agora (confirme)' }
        }
        if (total > 0) {
          return { ...c, detalhe: `confirmado no DataJud (${alias.toUpperCase()}) — confirme o teor` }
        }
        return {
          ...c,
          status: 'conferir',
          detalhe: `dígito válido, mas NÃO localizado no DataJud (${alias.toUpperCase()}) — confirme (pode não estar indexado ou correr em segredo)`,
        }
      }

      return c
    }),
  )

  return {
    itens,
    total: itens.length,
    verificadas: itens.filter((i) => i.status === 'verificada').length,
    aConferir:   itens.filter((i) => i.status === 'conferir').length,
    problemas:   itens.filter((i) => i.status === 'nao_verificada').length,
  }
}
