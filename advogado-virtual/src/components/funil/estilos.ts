import type { EtapaFunil } from '@/lib/funil/regras'

// ── Cores por etapa ─────────────────────────────────────────────────────────
// Cabeçalho colorido da coluna + tinta suave do corpo (kanban moderno).
export interface CoresEtapa { header: string; body: string; ring: string; cardTint: string }

export const CORES_ETAPA: Record<EtapaFunil, CoresEtapa> = {
  novo_lead:          { header: 'bg-slate-500 dark:bg-slate-600',    body: 'bg-slate-50 dark:bg-slate-900/40',      ring: 'ring-slate-300 dark:ring-slate-600',     cardTint: '' },
  consulta_agendada:  { header: 'bg-sky-500 dark:bg-sky-600',        body: 'bg-sky-50/70 dark:bg-sky-950/30',       ring: 'ring-sky-300 dark:ring-sky-700',         cardTint: '' },
  consulta_realizada: { header: 'bg-violet-500 dark:bg-violet-600',  body: 'bg-violet-50/70 dark:bg-violet-950/30', ring: 'ring-violet-300 dark:ring-violet-700',   cardTint: '' },
  proposta_enviada:   { header: 'bg-amber-500 dark:bg-amber-600',    body: 'bg-amber-50/70 dark:bg-amber-950/25',   ring: 'ring-amber-300 dark:ring-amber-700',     cardTint: '' },
  contrato_fechado:   { header: 'bg-emerald-500 dark:bg-emerald-600', body: 'bg-emerald-50/70 dark:bg-emerald-950/25', ring: 'ring-emerald-300 dark:ring-emerald-700', cardTint: 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900' },
  perdido:            { header: 'bg-rose-500 dark:bg-rose-600',      body: 'bg-rose-50/60 dark:bg-rose-950/20',     ring: 'ring-rose-300 dark:ring-rose-700',       cardTint: 'bg-card border-border/70 opacity-75' },
}

// ── Cores por área jurídica ─────────────────────────────────────────────────
export const CORES_AREA: Record<string, string> = {
  previdenciario: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300',
  trabalhista:    'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300',
  civel:          'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  criminal:       'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300',
  tributario:     'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  empresarial:    'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
  familia:        'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  medico:         'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
  consumidor:     'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  imobiliario:    'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  administrativo: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}
export const COR_AREA_PADRAO = 'bg-muted text-muted-foreground'
export const corArea = (area: string | null) => (area && CORES_AREA[area]) || COR_AREA_PADRAO

// ── Avatar colorido (determinístico pelo nome/telefone) ─────────────────────
const PALETA_AVATAR = [
  'bg-rose-500', 'bg-orange-500', 'bg-amber-500', 'bg-emerald-500', 'bg-teal-500',
  'bg-sky-500', 'bg-blue-500', 'bg-indigo-500', 'bg-violet-500', 'bg-pink-500',
]
export function corAvatar(chave: string): string {
  let h = 0
  for (let i = 0; i < chave.length; i++) h = (h * 31 + chave.charCodeAt(i)) >>> 0
  return PALETA_AVATAR[h % PALETA_AVATAR.length]
}

// ── Origem do lead → rótulo + cor do "dot" ──────────────────────────────────
export function estiloOrigem(origem: string | null): { label: string; dot: string } | null {
  if (!origem) return null
  const o = origem.toLowerCase()
  if (o.includes('teste')) return null
  if (o.includes('whats')) return { label: 'WhatsApp', dot: 'bg-green-500' }
  if (o.includes('meta') || o.includes('face') || o.includes('insta')) return { label: 'Meta', dot: 'bg-blue-600' }
  if (o.includes('google')) return { label: 'Google', dot: 'bg-red-500' }
  if (o.includes('site')) return { label: 'Site', dot: 'bg-slate-500' }
  if (o.includes('indic')) return { label: 'Indicação', dot: 'bg-amber-500' }
  return { label: origem, dot: 'bg-slate-400' }
}

// ── Tempo relativo em pt-BR ("há 12 min", "há 1h", "há 2 dias") ─────────────
export function tempoRelativo(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) return 'agora'
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `há ${h}h`
  const d = Math.floor(h / 24)
  if (d === 1) return 'ontem'
  if (d < 30) return `há ${d} dias`
  const mes = Math.floor(d / 30)
  return mes === 1 ? 'há 1 mês' : `há ${mes} meses`
}

export const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
