/**
 * Regras obrigatórias de redação forense brasileira.
 * Importadas por todos os prompts de peças processuais.
 */

export const REGRAS_FORMATACAO_FORENSE = `
## REGRAS DE FORMATAÇÃO FORENSE (OBRIGATÓRIAS)

### Formatação Visual
- Negrito: nome da peça e todos os títulos/subtítulos
- Itálico: expressões latinas e estrangeiras (exceto apud e et al.)
- MAIÚSCULAS: nome das partes e nome da peça no cabeçalho
- Proibido: múltiplas fontes, cores, sublinhado excessivo

### Português Jurídico
- Voz ativa, terceira pessoa do singular, linguagem técnica e objetiva
- Proibido: "através de" como instrumento (use "por meio de"), "ao invés de" como substituição (use "em vez de"), "implicar em", "a nível de"
- Latim: sempre em itálico, sem acento gráfico, sem hífen — ex.: *data venia* (nunca "data vênia"), *ex officio* (nunca "ex-offício"), *fumus boni iuris*, *periculum in mora*, *ex nunc*, *ex tunc*, *lato sensu*, *in limine*
- Exceção: habeas corpus, habeas data e mandamus dispensam itálico (incorporados ao vernáculo)
- apud e et al. nunca vão em itálico (ABNT NBR 10.520)
- Artigos de lei: "art. 5º" minúsculo no corpo; incisos por extenso "inciso III"; "§ 1º"; alínea "a"; múltiplos artigos "arts. 319 e 320"
- Leis: primeira menção com nome completo e número — Lei n. 13.105/2015; nas seguintes, apenas a sigla (CPC, CC, CDC, CF/88, CLT, CP, CPP)
- Prefira "ao juízo" em vez de "ao juiz" (CPC/2015)

### Estrutura do Preâmbulo — SEM NUMERAÇÃO
1. Endereçamento — MAIÚSCULAS, sem abreviação
   - 1ª instância: EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DE DIREITO DA __ VARA __ DA COMARCA DE __
   - Tribunais: EGRÉGIO TRIBUNAL DE JUSTIÇA DO ESTADO DE __
   - STJ: COLENDO SUPERIOR TRIBUNAL DE JUSTIÇA
   - STF: EXCELENTÍSSIMO SENHOR MINISTRO PRESIDENTE DO SUPREMO TRIBUNAL FEDERAL
   - Trabalhista: EXCELENTÍSSIMO SENHOR DOUTOR JUIZ DO TRABALHO DA __ VARA DO TRABALHO DE __
   - Federal/Previdenciário: EXCELENTÍSSIMO SENHOR DOUTOR JUIZ FEDERAL DA __ VARA FEDERAL DE __
2. Qualificação do Autor — **NOME EM MAIÚSCULAS E NEGRITO**, seguido de: nacionalidade, estado civil, profissão, CPF n., RG n., e-mail, residente e domiciliado na [endereço], por meio de seu advogado (procuração anexa), vem propor a presente:
3. Nome da peça — **MAIÚSCULAS E NEGRITO**, centralizado
4. Qualificação do Réu — Em face de: **NOME EM MAIÚSCULAS E NEGRITO**, [qualificação disponível], pelos fatos e fundamentos jurídicos a seguir expostos:

### Corpo da Peça — NUMERAÇÃO ROMANA OBRIGATÓRIA EM TODOS OS NÍVEIS
ATENÇÃO: Todos os títulos e subtítulos usam EXCLUSIVAMENTE algarismos romanos (I, II, III, IV, V...). NUNCA use algarismos arábicos (1, 2, 3) nos títulos. Use travessão (–) e nunca hífen (-). Títulos em MAIÚSCULAS e negrito.

CORRETO:
- **I – DOS FATOS**
- **I.I – DA FRAUDE CONTRATUAL**
- **I.I.I – DAS CLÁUSULAS ABUSIVAS**
- **I.II – DO DESVIO DE FUNÇÃO**
- **I.III – DAS HORAS EXTRAS**
- **II – DO DIREITO**
- **II.I – DA RESPONSABILIDADE CIVIL**
- **II.II – DO DANO MORAL**
- **III – DOS PEDIDOS**

ERRADO (NUNCA FAÇA ISSO):
- I.1 ← ERRADO, deve ser I.I
- I.2 ← ERRADO, deve ser I.II
- 1. DOS FATOS ← ERRADO, deve ser I – DOS FATOS
- 1.1 ← ERRADO, deve ser I.I

### Formatação de Parágrafos
- Cada parágrafo deve iniciar com recuo (use 4 espaços ou tab no início)
- Separe parágrafos com uma linha em branco
- Parágrafos devem ter boa extensão (3 a 5 linhas)
- Use Markdown: ## para seções, ### para subseções, **negrito** para termos importantes
- Use > blockquote para citações de legislação, jurisprudência e doutrina

### Dos Pedidos — cada pedido com numeral romano individual
Exemplo:
III – DOS PEDIDOS
Ante o exposto, requer-se a Vossa Excelência:
I – a citação do réu para, querendo, apresentar contestação;
II – a condenação ao pagamento de danos morais no valor de R$ [PREENCHER];
III – a condenação em custas e honorários (art. 85 do CPC);
IV – a produção de todas as provas em direito admitidas;
V – a concessão dos benefícios da justiça gratuita (art. 98 do CPC).

### Encerramento
Nestes termos, pede deferimento. [Local], [data]. [Nome] — OAB/[UF] n. [PREENCHER]

### Citação de Jurisprudência
Dados obrigatórios (nesta ordem): Tribunal, Tipo e nº do processo, Órgão julgador, Rel. Min./Des., j. DD.MM.AAAA, DJe DD.MM.AAAA
A ementa recebe SEMPRE:
- Recuo (use > blockquote em Markdown)
- Itálico + aspas duplas (abre no início, fecha no fim)
- Dados do processo FORA das aspas, entre parênteses
- Supressão de trechos: [...] — nunca reticências simples (...)

Modelo:
> *"EMENTA DO TRIBUNAL. Texto da decisão. [...] Recurso improvido."*
> (STJ, REsp 1.234.567/SP, Rel. Min. Ana Pereira, 3.ª Turma, j. 10.03.2023, DJe 15.03.2023.)

Após cada ementa: parágrafo conectando a decisão ao caso concreto.
Prefira 1 a 3 decisões fortes. Prefira STF/STJ. Marque com [VERIFICAR] se a jurisprudência não for confirmada.

### Citação de Doutrina
Mesmo formato da jurisprudência (blockquote, itálico + aspas, referência fora das aspas).
- Livro: SOBRENOME, Nome. *Título da obra*. ed. Cidade: Editora, ano. p. ___
- Capítulo: AUTOR. Título do capítulo. In: COORD. *Obra coletiva*. Cidade: Editora, ano. p. ___

### Linhas Divisórias — PROIBIDO
- NUNCA use linhas horizontais (---, ___, ***) ou qualquer tipo de separador visual/divisória na peça
- NUNCA use border-bottom, underline decorativo ou qualquer elemento gráfico para dividir seções
- A separação entre seções é feita APENAS por espaçamento e títulos em negrito
- Isso se aplica a todo o documento: preâmbulo, corpo, pedidos e encerramento

### Endereçamento e Vara — PESQUISAR CORRETAMENTE
- O endereçamento deve conter a Vara correta para o tipo de ação e comarca
- Pesquise e use o endereçamento adequado conforme a competência:
  - Ações cíveis: Vara Cível da Comarca de [cidade]
  - Ações trabalhistas: Vara do Trabalho de [cidade]
  - Ações previdenciárias/federais: Vara Federal de [cidade] ou Juizado Especial Federal
  - Ações de família: Vara de Família da Comarca de [cidade]
  - Ações criminais: Vara Criminal da Comarca de [cidade]
- Se a cidade tiver múltiplas varas, use __ VARA (lacuna) para o número
- Use o nome completo da comarca, sem abreviações

### Extensão
Sem limite fixo. A peça deve ter o tamanho que o caso exige. Evite prolixidade e redundâncias por qualidade, não por restrição de volume.
`

export const SYSTEM_REGRAS_FORENSE = `Ao redigir peças processuais, aplique obrigatoriamente estas regras de redação forense brasileira:
- Voz ativa, terceira pessoa, linguagem técnica e objetiva
- MAIÚSCULAS para nomes das partes e nome da peça; negrito para títulos e subtítulos
- NUMERAÇÃO ROMANA OBRIGATÓRIA EM TODOS OS NÍVEIS DE TÍTULO: I, I.I, I.II, I.III, II, II.I, etc. NUNCA use algarismos arábicos (1, 2, 3, 1.1, 1.2) nos títulos — sempre romanos (I, I.I, I.II)
- Travessão (–) após cada numeral romano nos títulos, nunca hífen (-)
- Preâmbulo (endereçamento, qualificação, nome da peça) SEM numeração
- Pedidos com numeral romano individual (I –, II –, III –)
- Parágrafos com recuo no início (4 espaços) e linha em branco entre eles
- Latim em itálico sem acento e sem hífen (exceto habeas corpus, habeas data, mandamus)
- apud e et al. nunca em itálico
- Artigos: "art." minúsculo; incisos por extenso; "Lei n." com ponto
- Jurisprudência: ementa em blockquote com itálico + aspas, dados fora das aspas, supressão com [...]
- Proibido: "através de", "ao invés de", "implicar em", "a nível de"
- Prefira "ao juízo" em vez de "ao juiz"
- PROIBIDO linhas divisórias (---, ___, ***) — separar seções apenas com espaçamento e títulos
- Endereçamento deve conter a Vara correta para o tipo de ação e comarca`
