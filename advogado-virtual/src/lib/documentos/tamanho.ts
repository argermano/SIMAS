// Humaniza um número de bytes para exibição (B/KB/MB/GB/TB). Base 1024.
// Bytes puros sem casa decimal; KB+ com 1 casa. Valores inválidos/≤0 → '0 B'.
export function formatarBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const unidades = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    unidades.length - 1,
  )
  const valor = bytes / Math.pow(1024, i)
  const texto = i === 0 ? String(Math.round(valor)) : valor.toFixed(1)
  return `${texto} ${unidades[i]}`
}
