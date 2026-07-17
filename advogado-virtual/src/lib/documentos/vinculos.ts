// Lógica pura dos vínculos N:N documento ↔ caso/processo (063). Fica fora das
// rotas para ser testável sem rede: agrupa as linhas de documento_vinculos por
// documento e deriva os campos "legado" (um caso/um processo) que a UI atual em
// produção ainda lê, até a fase UI passar a consumir o array `vinculos`.

// Item do contrato novo devolvido por doc (fase UI consome isto).
export type VinculoDoc =
  | { atendimento_id: string; processo_id: null; titulo: string | null }
  | { atendimento_id: null; processo_id: string; numero_cnj: string | null; apelido: string | null }

// Linha crua de documento_vinculos com os embeds de caso/processo (join em lote).
export interface VinculoRow {
  documento_id: string
  atendimento_id: string | null
  processo_id: string | null
  // Supabase devolve o embed como objeto OU array de 1 — normalizamos com `um`.
  atendimentos?: { titulo: string | null } | { titulo: string | null }[] | null
  processos?:
    | { numero_cnj: string | null; apelido: string | null }
    | { numero_cnj: string | null; apelido: string | null }[]
    | null
}

const um = <T>(v: T | T[] | null | undefined): T | null =>
  Array.isArray(v) ? (v[0] ?? null) : (v ?? null)

// Converte uma linha crua no item do contrato. Retorna null se a linha não tem
// alvo (não deveria acontecer — o CHECK garante exatamente um).
export function montarVinculo(row: VinculoRow): VinculoDoc | null {
  if (row.atendimento_id) {
    return {
      atendimento_id: row.atendimento_id,
      processo_id: null,
      titulo: um(row.atendimentos)?.titulo ?? null,
    }
  }
  if (row.processo_id) {
    const p = um(row.processos)
    return {
      atendimento_id: null,
      processo_id: row.processo_id,
      numero_cnj: p?.numero_cnj ?? null,
      apelido: p?.apelido ?? null,
    }
  }
  return null
}

// Agrupa as linhas por documento_id → lista de vínculos (mantém a ordem de entrada).
export function agruparVinculosPorDoc(rows: VinculoRow[]): Map<string, VinculoDoc[]> {
  const mapa = new Map<string, VinculoDoc[]>()
  for (const row of rows) {
    const v = montarVinculo(row)
    if (!v) continue
    const lista = mapa.get(row.documento_id)
    if (lista) lista.push(v)
    else mapa.set(row.documento_id, [v])
  }
  return mapa
}

// Campos "legado" (compat com DocumentosDossie atual): o 1º vínculo de cada tipo.
// Um doc SEM vínculo fica com tudo null (= geral). Um doc em N pastas mostra só a
// 1ª de cada tipo aqui — a lista completa vai em `vinculos` (a fase UI usa essa).
export function derivarLegado(vinculos: VinculoDoc[]): {
  atendimento_id: string | null
  atendimento_titulo: string | null
  processo_id: string | null
  processo_numero_cnj: string | null
  processo_apelido: string | null
} {
  const at = vinculos.find((v) => v.atendimento_id) as
    | Extract<VinculoDoc, { atendimento_id: string }>
    | undefined
  const pr = vinculos.find((v) => v.processo_id) as
    | Extract<VinculoDoc, { processo_id: string }>
    | undefined
  return {
    atendimento_id: at?.atendimento_id ?? null,
    atendimento_titulo: at?.titulo ?? null,
    processo_id: pr?.processo_id ?? null,
    processo_numero_cnj: pr?.numero_cnj ?? null,
    processo_apelido: pr?.apelido ?? null,
  }
}
