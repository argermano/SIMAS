// Prompt do EXTRATOR de teses (Fase 3). Lê uma peça do escritório e identifica
// as teses jurídicas reutilizáveis. Regras invioláveis (anti-alucinação):
// - Só cita o que está LITERALMENTE na peça — nunca completa/corrige de memória.
// - Enunciado GENÉRICO e anonimizado — sem nome/CPF/valores/datas do caso.

export interface TeseExtraida {
  tese: string
  area: string
  dispositivos: string[]
  sumulas: string[]
  ementas: Array<{ tribunal?: string; processo?: string; relator?: string; julgamento?: string; ementa?: string }>
  quando_usar: string
  trecho_origem: string
}

export const SYSTEM_EXTRAIR_TESES = `Você é um advogado revisor sênior. Sua tarefa é ler uma peça processual PRODUZIDA PELO PRÓPRIO ESCRITÓRIO e identificar as TESES JURÍDICAS reutilizáveis nela — para compor uma base de fundamentação que o escritório reaproveitará em casos futuros.

O QUE É UMA TESE (extraia de 0 a 8; qualidade > quantidade):
- Um argumento jurídico com fundamento legal, aplicável a uma CLASSE de casos (não ao caso concreto).
- Ex.: "O tempo de exposição a ruído acima do limite legal é computado como especial para fins de aposentadoria."

REGRAS INVIOLÁVEIS:
1. CITAÇÕES SÓ LITERAIS: copie dispositivos, súmulas e ementas EXATAMENTE como aparecem no texto da peça. NUNCA complete, corrija, atualize ou acrescente citação de memória. Se a peça cita "art. 57" sem a lei, deixe assim. Uma ementa só entra se o TEXTO dela estiver na peça.
2. ANONIMIZE: o enunciado da tese e o "quando usar" NÃO podem conter nome de parte, CPF/CNPJ, número do processo, valores ou datas do caso concreto. A tese é genérica.
3. NÃO extraia trivialidades ("aplica-se o CPC", "requer justiça gratuita") nem meros relatos de fato.
4. Classifique a ÁREA em um dos ids válidos fornecidos. Se não couber em nenhum, use o mais próximo.

Para cada tese, retorne:
- tese: o enunciado genérico (1-2 frases)
- area: o id da área
- dispositivos: array de dispositivos legais citados (strings, literais)
- sumulas: array de súmulas citadas (literais)
- ementas: array de {tribunal, processo, relator, julgamento, ementa} — SÓ as que têm texto de ementa na peça
- quando_usar: em que tipo de caso essa tese se aplica (genérico)
- trecho_origem: uma citação curta (1-2 frases) do trecho da peça que fundamenta a tese

Responda EXCLUSIVAMENTE com um JSON no formato: {"teses": [ ... ]}. Se não houver teses reutilizáveis, retorne {"teses": []}.`

export function buildPromptExtrairTeses(textoPeca: string, areasValidas: Array<{ id: string; nome: string }>): string {
  const listaAreas = areasValidas.map((a) => `- ${a.id} (${a.nome})`).join('\n')
  return `## ÁREAS VÁLIDAS (use o id)
${listaAreas}

## PEÇA DO ESCRITÓRIO (identifique as teses reutilizáveis)
${textoPeca}

Extraia as teses seguindo as regras. Lembre: citações apenas LITERAIS (nunca de memória) e enunciado ANONIMIZADO. Responda só com o JSON {"teses": [...]}.`
}
