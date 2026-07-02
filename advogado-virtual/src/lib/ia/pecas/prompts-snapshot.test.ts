import { describe, it, expect } from 'vitest'
import { PROMPT_MAP } from './registro-pecas'

// Snapshot de proteção dos prompts curados: trava o texto exato (system +
// prompt construído) de CADA combinação registrada em PROMPT_MAP para uma
// entrada FIXA e determinística. Objetivo: garantir que refatorações futuras
// (ex.: camadas base+área+peça+modo) NÃO alterem o conteúdo dos prompts já
// validados. Se um snapshot mudar sem intenção, o teste falha.
//
// Novos prompts adicionados ao PROMPT_MAP geram novos snapshots
// automaticamente (não alteram os existentes).

const ENTRADA_FIXA = {
  analise: {
    tese_principal: 'Direito ao benefício/pretensão conforme os fatos narrados.',
    fundamentos: ['fundamento A', 'fundamento B'],
    pontos_de_atencao: ['prazo', 'prova'],
  },
  transcricao:
    'O cliente relatou que trabalhou de 2005 a 2020 em atividades diversas e que ' +
    'teve seu pedido administrativo indeferido. Descreveu as condições e os fatos ' +
    'relevantes para a pretensão, com datas e valores aproximados.',
  pedido_especifico: 'Reforma da decisão e acolhimento integral da pretensão.',
  documentos: [
    {
      tipo: 'CNIS',
      // Texto propositalmente longo (>500 chars) para travar o comportamento
      // de truncamento dos builders existentes.
      texto_extraido:
        'Vínculos empregatícios registrados: Empresa Alfa Ltda (2005-2010), ' +
        'Empresa Beta S/A (2011-2016), Empresa Gama ME (2017-2020). '.repeat(20),
      file_name: 'cnis.pdf',
    },
    {
      tipo: 'documento_pessoal',
      texto_extraido: 'João da Silva, CPF 123.456.789-00, RG 12.345.678 SSP/SP.',
      file_name: 'rg.png',
    },
  ],
  localizacao: { cidade: 'Campinas', estado: 'SP' },
  qualificacao: {
    autor: {
      nome: 'João da Silva',
      cpf: '123.456.789-00',
      rg: '12.345.678',
      orgao_expedidor: 'SSP/SP',
      estado_civil: 'casado',
      nacionalidade: 'brasileiro',
      profissao: 'pedreiro',
      endereco: 'Rua das Flores, 100',
      bairro: 'Centro',
      cidade: 'Campinas',
      estado: 'SP',
      cep: '13000-000',
      email: 'joao@exemplo.com',
    },
    reu: {
      nome: 'Instituto Nacional do Seguro Social — INSS',
      cnpj_cpf: '29.979.036/0001-40',
      endereco: 'Setor de Autarquias Sul',
      cidade: 'Brasília',
      estado: 'DF',
    },
  },
}

describe('snapshot dos prompts curados', () => {
  for (const [area, tipos] of Object.entries(PROMPT_MAP)) {
    for (const [tipo, curado] of Object.entries(tipos)) {
      it(`${area} / ${tipo} — system e prompt estáveis`, () => {
        expect(curado.system).toMatchSnapshot('system')
        expect(curado.build(ENTRADA_FIXA)).toMatchSnapshot('prompt')
      })
    }
  }
})
