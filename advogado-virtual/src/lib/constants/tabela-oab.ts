/**
 * Tabela de Honorários da OAB — referência para geração de contratos.
 * Baseada na Tabela de Honorários da OAB/SP (Resolução 02/2010 e atualizações).
 * Atualizar manualmente quando a tabela OAB for revisada.
 *
 * Valores expressos em % sobre o benefício econômico obtido ou em salários mínimos (SM).
 */

export const TABELA_OAB_REFERENCIA = `
TABELA DE HONORÁRIOS OAB (Referência — OAB/SP e CFOAB)

1. HONORÁRIOS DE ÊXITO (% sobre o valor da causa ou benefício obtido)
   • Causas trabalhistas: 20% a 30%
   • Causas previdenciárias: 20% a 30% (limitado pela legislação previdenciária ao teto de 30% de 12 parcelas)
   • Causas cíveis em geral: 20% a 30%
   • Causas contra a Fazenda Pública: 10% a 20%
   • Causas criminais (réu absolvido): 20% a 30%

2. HONORÁRIOS FIXOS (mínimos recomendados — base em Salários Mínimos, SM vigente)
   • Consulta e parecer jurídico: 2 SM a 10 SM
   • Contrato simples e distrato: 2 SM a 10 SM
   • Inventário extrajudicial: 5% do valor do espólio
   • Divórcio consensual extrajudicial: 2 SM a 5 SM
   • Habeas corpus, mandado de segurança: 5 SM a 20 SM
   • Ação de cobrança (fase administrativa): 5% a 10% do valor cobrado
   • Execução de sentença: 5% a 10%
   • Recurso (por instância): 2 SM a 20 SM

3. CAUSAS PREVIDENCIÁRIAS (regras específicas — Lei 8.213/91, art. 133)
   • Máximo legal: 30% sobre valor dos atrasados (parcelas vencidas) — vedado cobrar sobre prestações futuras
   • É recomendado 20% de êxito + honorários mensais de acompanhamento de 1 SM a 3 SM

4. CAUSAS TRABALHISTAS (CLT)
   • Recomendado: 20% a 30% de êxito sobre o valor líquido recebido
   • Adiantamento de custas: 1 SM a 3 SM

OBSERVAÇÕES:
- Os percentuais acima são recomendações mínimas; o advogado pode convencionar valores maiores.
- O valor do Salário Mínimo vigente deve ser consultado no ato da elaboração do contrato.
- Para honorários abaixo do mínimo recomendado, é necessária justificativa fundamentada.
- Gratuidade de Justiça: clientes que obtiverem JG não podem ser cobrados pelos honorários contratuais.
`.trim()
