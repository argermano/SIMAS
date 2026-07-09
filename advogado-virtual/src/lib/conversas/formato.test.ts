import { describe, it, expect } from 'vitest'
import { horaCurta, dataHoraCurta, dataHoraCompleta, agrupadorDia } from './formato'

// Epoch(seg) determinístico: 2024-03-15 17:30:00 UTC = 14:30 em America/Sao_Paulo (UTC-3).
const EPOCH = Date.UTC(2024, 2, 15, 17, 30, 0) / 1000

describe('formato — datas (America/Sao_Paulo, pt-BR)', () => {
  describe('horaCurta', () => {
    it('formata "HH:mm" no fuso de SP', () => {
      expect(horaCurta(EPOCH)).toBe('14:30')
    })
    it('retorna "" para null/undefined/NaN', () => {
      expect(horaCurta(null)).toBe('')
      expect(horaCurta(undefined)).toBe('')
      expect(horaCurta(NaN)).toBe('')
    })
  })

  describe('dataHoraCurta', () => {
    it('formata "DD/MM HH:mm"', () => {
      expect(dataHoraCurta(EPOCH)).toBe('15/03 14:30')
    })
    it('retorna "" para inválido', () => {
      expect(dataHoraCurta(null)).toBe('')
    })
  })

  describe('dataHoraCompleta', () => {
    it('formata "DD/MM/YYYY às HH:mm"', () => {
      expect(dataHoraCompleta(EPOCH)).toBe('15/03/2024 às 14:30')
    })
    it('retorna "" para inválido', () => {
      expect(dataHoraCompleta(undefined)).toBe('')
    })
  })

  describe('agrupadorDia', () => {
    it('gera "YYYY-MM-DD" no fuso de SP', () => {
      expect(agrupadorDia(EPOCH)).toBe('2024-03-15')
    })
    it('usa o dia local de SP mesmo quando UTC já virou o dia', () => {
      // 2024-03-16 01:00 UTC = 2024-03-15 22:00 em SP → ainda dia 15.
      const cruzaMeiaNoite = Date.UTC(2024, 2, 16, 1, 0, 0) / 1000
      expect(agrupadorDia(cruzaMeiaNoite)).toBe('2024-03-15')
    })
    it('retorna "" para inválido', () => {
      expect(agrupadorDia(null)).toBe('')
    })
  })
})
