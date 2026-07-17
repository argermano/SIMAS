import { describe, it, expect } from 'vitest'
import { recebedorEhEscritorio, type ConfigRecebedor } from './recebedor'

// Config do escritório de teste (caso real do dono): a titular é Katlen Germano;
// o Pix das cobranças usa e-mail; a razão social é a sociedade individual.
const CFG: ConfigRecebedor = {
  pixChave: 'katlen@adv.br',
  pixNome: 'Katlen Germano',
  tenantNome: 'KATLEN GERMANO SOCIEDADE INDIVIDUAL DE ADVOCACIA',
}

describe('recebedorEhEscritorio — filtro por recebedor', () => {
  it("razão social completa da banca → 'sim' (casa KATLEN+GERMANO)", () => {
    expect(
      recebedorEhEscritorio({ recebedorNome: 'KATLEN GERMANO SOCIEDADE INDIVIDUAL DE ADVOCACIA' }, CFG),
    ).toBe('sim')
  })

  it("conta pessoal da titular → 'sim' (nome com acento/ordem diferente)", () => {
    expect(recebedorEhEscritorio({ recebedorNome: 'Katlen Nardes Germano' }, CFG)).toBe('sim')
  })

  it("um sobrenome distintivo já basta → 'sim'", () => {
    expect(recebedorEhEscritorio({ recebedorNome: 'Germano' }, CFG)).toBe('sim')
  })

  it("terceiro (pessoa física) → 'nao'", () => {
    expect(recebedorEhEscritorio({ recebedorNome: 'João da Silva Pereira' }, CFG)).toBe('nao')
  })

  it("INSS → 'nao'", () => {
    expect(recebedorEhEscritorio({ recebedorNome: 'INSS' }, CFG)).toBe('nao')
    expect(recebedorEhEscritorio({ recebedorNome: 'Instituto Nacional do Seguro Social' }, CFG)).toBe('nao')
  })

  it("outra banca (só genéricos coincidem) → 'nao', não falso positivo", () => {
    // Compartilha SOCIEDADE/ADVOGADOS/DE, mas nenhum token distintivo → terceiro.
    expect(recebedorEhEscritorio({ recebedorNome: 'Silva Santos Sociedade de Advogados' }, CFG)).toBe('nao')
  })

  it("sem recebedorNome e sem chaveDestino → 'desconhecido' (na dúvida entra)", () => {
    expect(recebedorEhEscritorio({}, CFG)).toBe('desconhecido')
  })

  it("recebedorNome só com genéricos → 'desconhecido' (inconclusivo)", () => {
    expect(recebedorEhEscritorio({ recebedorNome: 'Sociedade de Advocacia' }, CFG)).toBe('desconhecido')
  })

  it("chaveDestino == pixChave vence, mesmo com nome estranho → 'sim'", () => {
    // Chave de destino (e-mail em caixa alta) normaliza igual à configurada.
    expect(
      recebedorEhEscritorio({ recebedorNome: 'Fulano de Tal', chaveDestino: 'KATLEN@ADV.BR' }, CFG),
    ).toBe('sim')
  })

  it('chaveDestino Pix por CPF pontuado casa com a chave configurada só-dígitos', () => {
    const cfgCpf: ConfigRecebedor = { pixChave: '12345678900', pixNome: 'Katlen Germano', tenantNome: null }
    expect(recebedorEhEscritorio({ chaveDestino: '123.456.789-00' }, cfgCpf)).toBe('sim')
  })

  it("chaveDestino diferente e sem nome → 'desconhecido' (chave só dá sinal positivo)", () => {
    // Conta pessoal da titular pode ter chave ≠ da configurada; não prova terceiro.
    expect(recebedorEhEscritorio({ chaveDestino: 'outra@banco.br' }, CFG)).toBe('desconhecido')
  })

  it("config sem nomes de referência → 'desconhecido' (não descarta às cegas)", () => {
    const cfgVazia: ConfigRecebedor = { pixChave: null, pixNome: null, tenantNome: null }
    expect(recebedorEhEscritorio({ recebedorNome: 'Qualquer Pessoa' }, cfgVazia)).toBe('desconhecido')
  })
})
