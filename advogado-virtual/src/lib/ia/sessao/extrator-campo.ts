// Extrator INCREMENTAL de um campo de texto de um JSON que ainda está chegando.
//
// Por que existe: a rodada da sessão usa structured output, então o que o modelo
// transmite é o JSON do envelope — não o texto que o advogado quer ler. Sem este
// extrator, ou o painel mostraria `{"resposta_markdown":"Analis` na tela, ou
// teríamos de esperar a rodada inteira terminar para exibir a primeira palavra
// (numa rodada com 3 seções longas, meio minuto de tela parada).
//
// Ele varre os chunks à medida que chegam, acha o campo pedido (o schema o
// coloca em primeiro lugar de propósito) e devolve o texto JÁ DECODIFICADO
// (\n, \", \uXXXX) do valor daquela string, parando no fechamento das aspas.
// Puro, sem estado global, sem dependências — e testável caractere a caractere.

/** Fatia pendente de um escape incompleto na fronteira de dois chunks. */
const MAX_PENDENTE = 6 // \uXXXX

export interface ExtratorCampo {
  /** Consome um pedaço do stream e devolve o texto novo do campo (pode ser ''). */
  consumir(chunk: string): string
  /** true quando o valor do campo já terminou (aspas de fechamento). */
  concluido(): boolean
  /** Todo o texto decodificado até agora. */
  texto(): string
}

type Estado = 'procurando' | 'dentro' | 'fim'

/**
 * Cria um extrator para o valor string da propriedade `campo` do objeto raiz.
 *
 * Reconhecimento simples e deliberado: procura a sequência `"<campo>"` seguida
 * (com espaços opcionais) de `:` e da aspa de abertura do valor. É suficiente
 * porque o campo é a PRIMEIRA propriedade do envelope; se por algum motivo não
 * for encontrado, o extrator simplesmente nunca emite nada e a rodada segue pelo
 * caminho normal (o texto completo é lido e validado no fim).
 */
export function criarExtratorCampo(campo: string): ExtratorCampo {
  const marca = `"${campo}"`
  let estado: Estado = 'procurando'
  let buffer = ''      // usado na fase 'procurando' (e para escapes parciais)
  let acumulado = ''
  let escapando = false

  /** Decodifica o corpo da string JSON, parando na aspa de fechamento. */
  function consumirDentro(entrada: string): string {
    let saida = ''
    let i = 0
    // Retoma o escape que ficou pela metade no chunk anterior (buffer).
    const texto = buffer + entrada
    buffer = ''

    while (i < texto.length) {
      const c = texto[i]

      if (escapando) {
        escapando = false
        i++
        switch (c) {
          case 'n': saida += '\n'; break
          case 't': saida += '\t'; break
          case 'r': saida += '\r'; break
          case 'b': saida += '\b'; break
          case 'f': saida += '\f'; break
          case '"': saida += '"'; break
          case '\\': saida += '\\'; break
          case '/': saida += '/'; break
          case 'u': {
            // Precisa de 4 dígitos hex; se não chegaram todos, guarda e espera.
            if (i + 4 > texto.length) {
              buffer = `\\u${texto.slice(i)}`
              return saida
            }
            const hex = texto.slice(i, i + 4)
            saida += String.fromCharCode(parseInt(hex, 16))
            i += 4
            break
          }
          default: saida += c
        }
        continue
      }

      if (c === '\\') {
        // Barra invertida no último caractere do chunk: espera o próximo.
        if (i === texto.length - 1) {
          buffer = '\\'
          return saida
        }
        escapando = true
        i++
        continue
      }

      if (c === '"') {
        estado = 'fim'
        return saida
      }

      saida += c
      i++
    }

    return saida
  }

  return {
    consumir(chunk: string): string {
      if (estado === 'fim' || !chunk) return ''

      if (estado === 'procurando') {
        buffer += chunk
        const pos = buffer.indexOf(marca)
        if (pos === -1) {
          // Guarda só o rabo necessário para casar a marca partida entre chunks.
          if (buffer.length > marca.length + MAX_PENDENTE) {
            buffer = buffer.slice(-(marca.length + MAX_PENDENTE))
          }
          return ''
        }
        // Depois da marca vem `:` e a aspa de abertura do valor.
        const depois = buffer.slice(pos + marca.length)
        const abre = depois.match(/^\s*:\s*"/)
        if (!abre) {
          // Ainda não chegou o `: "` — espera o próximo chunk sem perder nada.
          buffer = buffer.slice(pos)
          return ''
        }
        const resto = depois.slice(abre[0].length)
        estado = 'dentro'
        buffer = ''
        const texto = consumirDentro(resto)
        acumulado += texto
        return texto
      }

      const texto = consumirDentro(chunk)
      acumulado += texto
      return texto
    },
    concluido: () => estado === 'fim',
    texto: () => acumulado,
  }
}
