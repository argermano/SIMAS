/**
 * Rotina de pós-processamento que valida e corrige a formatação
 * de peças processuais geradas pela IA, garantindo conformidade
 * com as regras de formatação forense antes de exibir ao usuário.
 */

// ─── Mapa arábico → romano ───────────────────────────────────
const ARABIC_TO_ROMAN: Record<number, string> = {
  1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V',
  6: 'VI', 7: 'VII', 8: 'VIII', 9: 'IX', 10: 'X',
  11: 'XI', 12: 'XII', 13: 'XIII', 14: 'XIV', 15: 'XV',
  16: 'XVI', 17: 'XVII', 18: 'XVIII', 19: 'XIX', 20: 'XX',
}

function arabicToRoman(n: number): string {
  return ARABIC_TO_ROMAN[n] ?? String(n)
}

// ─── Expressões latinas que devem estar em itálico ───────────
const LATIN_EXPRESSIONS = [
  'data venia', 'ex officio', 'fumus boni iuris', 'periculum in mora',
  'ex nunc', 'ex tunc', 'lato sensu', 'stricto sensu', 'in limine',
  'ad hoc', 'ab initio', 'de cujus', 'de facto', 'de jure',
  'erga omnes', 'ex vi', 'in casu', 'in dubio pro reo',
  'in dubio pro operario', 'inter partes', 'ipso facto', 'jus postulandi',
  'litis consortium', 'modus operandi', 'nulla poena sine lege',
  'onus probandi', 'pari passu', 'per capita', 'prima facie',
  'quantum debeatur', 'ratio decidendi', 'res judicata', 'sine qua non',
  'stare decisis', 'status quo', 'sub judice', 'sui generis',
  'ultra petita', 'extra petita', 'citra petita', 'animus necandi',
  'animus injuriandi', 'bis in idem', 'caput', 'pacta sunt servanda',
  'rebus sic stantibus', 'venire contra factum proprium',
  'nemo tenetur se detegere', 'reformatio in pejus',
  'tantum devolutum quantum appellatum', 'in dubio pro societate',
]

// Exceções: não recebem itálico (incorporados ao vernáculo ou regra ABNT)
const LATIN_NO_ITALIC = ['habeas corpus', 'habeas data', 'mandamus', 'apud', 'et al.', 'et al']

// ─── Expressões proibidas e suas substituições ───────────────
const PROHIBITED_EXPRESSIONS: [RegExp, string][] = [
  [/\batravés de\b/gi, 'por meio de'],
  [/\bao invés de\b/gi, 'em vez de'],
  [/\bimplicar em\b/gi, 'implicar'],
  [/\ba nível de\b/gi, 'em nível de'],
]

/**
 * Aplica todas as regras de formatação forense ao markdown gerado pela IA.
 * Retorna o markdown corrigido.
 */
export function formatarPeca(markdown: string): string {
  let result = markdown

  // 0. Remover blocos de código markdown que a IA pode adicionar
  result = removerBlocoCodigo(result)

  // 1. Remover linhas divisórias (---, ___, ***, ou variações)
  result = removerLinhasDivisorias(result)

  // 2. Corrigir numeração: arábicos → romanos nos títulos
  result = corrigirNumeracaoTitulos(result)

  // 3. Garantir travessão (–) nos títulos, nunca hífen (-)
  result = corrigirTravessaoTitulos(result)

  // 4. Garantir títulos em negrito e maiúsculas
  result = formatarTitulos(result)

  // 5. Italicizar expressões latinas (exceto exceções)
  result = italicizarLatim(result)

  // 6. Corrigir expressões proibidas
  result = corrigirExpressoesProibidas(result)

  // 7. Garantir espaçamento entre parágrafos
  result = garantirEspacamento(result)

  // 8. Limpar artefatos residuais
  result = limparArtefatos(result)

  return result.trim()
}

// ─── 0. Remover blocos de código que a IA envolve a peça ────
function removerBlocoCodigo(text: string): string {
  let result = text.trim()
  // Remove ```markdown ... ``` ou ``` ... ``` que envolve todo o conteúdo
  result = result.replace(/^```(?:markdown|md|text|html)?\s*\n?/i, '')
  result = result.replace(/\n?```\s*$/, '')
  return result.trim()
}

// ─── 1. Remover linhas divisórias ────────────────────────────
function removerLinhasDivisorias(text: string): string {
  const lines = text.split('\n')
  return lines.filter(line => {
    const trimmed = line.trim()
    // Remove ----, ____, ****, ou variações com espaços
    if (/^[-]{3,}$/.test(trimmed)) return false
    if (/^[_]{3,}$/.test(trimmed)) return false
    if (/^[*]{3,}$/.test(trimmed)) return false
    if (/^[-\s]{3,}$/.test(trimmed) && trimmed.replace(/\s/g, '').length >= 3 && /^[-\s]+$/.test(trimmed)) return false
    return true
  }).join('\n')
}

// ─── 2. Corrigir numeração arábica → romana ──────────────────
function corrigirNumeracaoTitulos(text: string): string {
  const lines = text.split('\n')

  return lines.map(line => {
    const trimmed = line.trim()

    // Títulos markdown (## ou ###) com numeração arábica
    // Ex: ## 1. DOS FATOS → ## I – DOS FATOS
    // Ex: ## 1 - DOS FATOS → ## I – DOS FATOS
    const matchHeading = trimmed.match(/^(#{2,3})\s+\**(\d+)\.\s*(.*)/);
    if (matchHeading) {
      const [, hashes, num, rest] = matchHeading
      const roman = arabicToRoman(parseInt(num))
      const cleanRest = rest.replace(/\*\*/g, '').trim()
      return `${hashes} **${roman} – ${cleanRest}**`
    }

    // Títulos markdown com sub-numeração arábica: ## 1.1 ou ### 1.1
    // Ex: ### 1.1 DA FRAUDE → ### I.I – DA FRAUDE
    const matchSubHeading = trimmed.match(/^(#{2,3})\s+\**(\d+)\.(\d+)\s*[–\-.]?\s*(.*)/);
    if (matchSubHeading) {
      const [, hashes, major, minor, rest] = matchSubHeading
      const romanMajor = arabicToRoman(parseInt(major))
      const romanMinor = arabicToRoman(parseInt(minor))
      const cleanRest = rest.replace(/\*\*/g, '').trim()
      const separator = cleanRest ? ' – ' : ''
      return `${hashes} **${romanMajor}.${romanMinor}${separator}${cleanRest}**`
    }

    // Sub-sub-numeração: ### 1.1.1
    const matchSubSubHeading = trimmed.match(/^(#{2,3})\s+\**(\d+)\.(\d+)\.(\d+)\s*[–\-.]?\s*(.*)/);
    if (matchSubSubHeading) {
      const [, hashes, a, b, c, rest] = matchSubSubHeading
      const rA = arabicToRoman(parseInt(a))
      const rB = arabicToRoman(parseInt(b))
      const rC = arabicToRoman(parseInt(c))
      const cleanRest = rest.replace(/\*\*/g, '').trim()
      const separator = cleanRest ? ' – ' : ''
      return `${hashes} **${rA}.${rB}.${rC}${separator}${cleanRest}**`
    }

    // Títulos sem markdown heading mas com numeração arábica no início da linha
    // Ex: **1. DOS FATOS** → **I – DOS FATOS**
    const matchBoldArabic = trimmed.match(/^\*\*(\d+)\.\s*(.*?)\*\*$/)
    if (matchBoldArabic) {
      const [, num, rest] = matchBoldArabic
      const roman = arabicToRoman(parseInt(num))
      return `**${roman} – ${rest}**`
    }

    // Ex: **1.1 DA FRAUDE** → **I.I – DA FRAUDE**
    const matchBoldSubArabic = trimmed.match(/^\*\*(\d+)\.(\d+)\s*[–\-.]?\s*(.*?)\*\*$/)
    if (matchBoldSubArabic) {
      const [, major, minor, rest] = matchBoldSubArabic
      const romanMajor = arabicToRoman(parseInt(major))
      const romanMinor = arabicToRoman(parseInt(minor))
      const separator = rest ? ' – ' : ''
      return `**${romanMajor}.${romanMinor}${separator}${rest}**`
    }

    // Títulos romanos com sub-arábicos misturados: I.1 → I.I
    // Procura por padrões como I.1, II.1, III.2 etc. dentro de títulos
    const matchRomanArabicMix = trimmed.match(/^(#{0,3}\s*)\**((?:X{0,3}(?:IX|IV|V?I{0,3}))\.(\d+))\s*[–\-]?\s*(.*?)(\**)$/)
    if (matchRomanArabicMix && /^[IVXLCDM]+\.\d+/.test(matchRomanArabicMix[2])) {
      const [, prefix, , arabicPart, rest, suffix] = matchRomanArabicMix
      const parts = matchRomanArabicMix[2].split('.')
      const romanPart = parts[0]
      const romanMinor = arabicToRoman(parseInt(arabicPart))
      const cleanRest = rest.replace(/\*\*/g, '').trim()
      const separator = cleanRest ? ' – ' : ''
      const hasBold = suffix === '**' || trimmed.includes('**')
      if (hasBold) {
        return `${prefix}**${romanPart}.${romanMinor}${separator}${cleanRest}**`
      }
      return `${prefix}${romanPart}.${romanMinor}${separator}${cleanRest}`
    }

    return line
  }).join('\n')
}

// ─── 3. Garantir travessão nos títulos ───────────────────────
function corrigirTravessaoTitulos(text: string): string {
  const lines = text.split('\n')

  return lines.map(line => {
    const trimmed = line.trim()

    // Títulos com ## ou ### que usam hífen (-) em vez de travessão (–)
    // Só corrige se for padrão ROMANO - TEXTO (não dentro de palavras)
    if (/^#{2,3}\s/.test(trimmed)) {
      // Padrão: ## **III - DOS PEDIDOS** → ## **III – DOS PEDIDOS**
      return line.replace(
        /(\*{0,2}(?:[IVXLCDM]+(?:\.[IVXLCDM]+)*)\s*)\s-\s/g,
        '$1 – '
      )
    }

    // Títulos bold sem heading: **III - DOS PEDIDOS** → **III – DOS PEDIDOS**
    if (/^\*\*[IVXLCDM]/.test(trimmed)) {
      return line.replace(
        /(\*\*(?:[IVXLCDM]+(?:\.[IVXLCDM]+)*)\s*)\s-\s/g,
        '$1 – '
      )
    }

    // Pedidos: III - texto → III – texto
    if (/^[IVXLCDM]+\s+-\s+/.test(trimmed)) {
      return line.replace(/^([IVXLCDM]+)\s+-\s+/, '$1 – ')
    }

    return line
  }).join('\n')
}

// ─── 4. Garantir títulos em negrito e maiúsculas ─────────────
function formatarTitulos(text: string): string {
  const lines = text.split('\n')

  return lines.map(line => {
    const trimmed = line.trim()

    // Títulos ## e ### devem ter conteúdo em negrito e maiúsculas
    const matchHeading = trimmed.match(/^(#{2,3})\s+(.+)$/)
    if (matchHeading) {
      let [, hashes, content] = matchHeading

      // Remove ** existentes para reprocessar
      const cleanContent = content.replace(/\*\*/g, '').trim()

      // Verifica se é um título de seção com numeral romano
      if (/^[IVXLCDM]+(?:\.[IVXLCDM]+)*\s*[–\-]/.test(cleanContent)) {
        // Converte para maiúsculas e aplica negrito
        return `${hashes} **${cleanContent.toUpperCase()}**`
      }

      // Títulos sem numeral romano — manter como está mas garantir negrito
      if (!content.startsWith('**')) {
        return `${hashes} **${cleanContent}**`
      }
    }

    return line
  }).join('\n')
}

// ─── 5. Italicizar expressões latinas ────────────────────────
function italicizarLatim(text: string): string {
  let result = text

  // Primeiro, garantir que as exceções NÃO tenham itálico
  for (const exception of LATIN_NO_ITALIC) {
    // Remove itálico de exceções: *habeas corpus* → habeas corpus
    const regExc = new RegExp(`\\*(?!\\*)(${escapeRegex(exception)})\\*(?!\\*)`, 'gi')
    result = result.replace(regExc, '$1')
  }

  // Agora, adicionar itálico às expressões latinas que não têm
  for (const expr of LATIN_EXPRESSIONS) {
    // Não processar se já está em itálico
    // Match a expressão que NÃO está entre * (itálico)
    const regNotItalic = new RegExp(
      `(?<!\\*)(\\b${escapeRegex(expr)}\\b)(?!\\*)`,
      'gi'
    )
    result = result.replace(regNotItalic, (match) => {
      return `*${match}*`
    })
  }

  // Limpar itálicos duplos que podem ter sido criados: **text** → *text*
  result = result.replace(/\*{3,}([^*]+)\*{3,}/g, '***$1***')

  return result
}

// ─── 6. Corrigir expressões proibidas ────────────────────────
function corrigirExpressoesProibidas(text: string): string {
  let result = text
  for (const [pattern, replacement] of PROHIBITED_EXPRESSIONS) {
    result = result.replace(pattern, (match) => {
      // Preservar capitalização da primeira letra
      if (match[0] === match[0].toUpperCase()) {
        return replacement[0].toUpperCase() + replacement.slice(1)
      }
      return replacement
    })
  }
  return result
}

// ─── 7. Garantir espaçamento entre parágrafos ────────────────
function garantirEspacamento(text: string): string {
  const lines = text.split('\n')
  const result: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const trimmed = line.trim()
    const nextLine = lines[i + 1]?.trim() ?? ''

    result.push(line)

    // Se a linha atual tem conteúdo e a próxima também,
    // e nenhuma é título ou blockquote, adicionar linha em branco
    if (
      trimmed &&
      nextLine &&
      !trimmed.startsWith('#') &&
      !nextLine.startsWith('#') &&
      !trimmed.startsWith('>') &&
      !nextLine.startsWith('>') &&
      !trimmed.startsWith('-') &&
      !nextLine.startsWith('-') &&
      lines[i + 1] !== undefined &&
      lines[i + 1]?.trim() !== '' &&
      // Não adicionar se já tem linha vazia
      !(i + 1 < lines.length && lines[i + 1]?.trim() === '')
    ) {
      // Verificar se são dois parágrafos consecutivos sem espaço
      const isParagraph = !trimmed.startsWith('#') && !trimmed.startsWith('>') && !trimmed.startsWith('|')
      const nextIsParagraph = !nextLine.startsWith('#') && !nextLine.startsWith('>') && !nextLine.startsWith('|')

      if (isParagraph && nextIsParagraph && trimmed.length > 20 && nextLine.length > 20) {
        result.push('')
      }
    }
  }

  // Remover múltiplas linhas em branco consecutivas (máx 1)
  return result.join('\n').replace(/\n{3,}/g, '\n\n')
}

// ─── 8. Limpar artefatos residuais ───────────────────────────
function limparArtefatos(text: string): string {
  let result = text

  // Remover comentários markdown <!-- -->
  result = result.replace(/<!--[\s\S]*?-->/g, '')

  // Remover acentos em expressões latinas comuns
  result = result.replace(/data\s+vênia/gi, 'data venia')
  result = result.replace(/ex[-\s]offício/gi, 'ex officio')
  result = result.replace(/ex[-\s]ofício/gi, 'ex officio')

  // Corrigir Art. → art. (minúsculo no corpo do texto, não em início de frase)
  result = result.replace(/(?<=[,;]\s)Art\.\s/g, 'art. ')

  // Garantir "Lei n." com ponto
  result = result.replace(/\bLei n(?!\.)(\s)/g, 'Lei n.$1')
  result = result.replace(/\bLei nº\b/g, 'Lei n.')

  return result
}

// ─── Helpers ─────────────────────────────────────────────────
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
