import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Formata CPF: "12345678901" → "123.456.789-01"
export function formatarCPF(cpf: string): string {
  const apenas = cpf.replace(/\D/g, '')
  return apenas.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
}

// Mascara CPF para exibição: "123.456.789-01" → "***.456.***-**"
export function mascaraCPF(cpf: string): string {
  const fmt = formatarCPF(cpf)
  return fmt.replace(/^(\d{3})(.+)(\d{2})$/, '***$2**')
}

// Formata telefone: "11999990000" → "(11) 99999-0000"
export function formatarTelefone(tel: string): string {
  const apenas = tel.replace(/\D/g, '')
  if (apenas.length === 11) {
    return apenas.replace(/(\d{2})(\d{5})(\d{4})/, '($1) $2-$3')
  }
  return apenas.replace(/(\d{2})(\d{4})(\d{4})/, '($1) $2-$3')
}

// Formata data ISO para pt-BR: "2024-03-15" → "15/03/2024"
export function formatarData(iso: string): string {
  if (!iso) return ''
  const [ano, mes, dia] = iso.split('T')[0].split('-')
  return `${dia}/${mes}/${ano}`
}

// Formata data + hora: "2024-03-15T14:30:00" → "15/03/2024 às 14:30"
export function formatarDataHora(iso: string): string {
  if (!iso) return ''
  const data = new Date(iso)
  return data.toLocaleString('pt-BR', {
    day:    '2-digit',
    month:  '2-digit',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  }).replace(',', ' às')
}

// Formata data relativa: "há 2 dias", "há 3 horas"
export function formatarDataRelativa(iso: string): string {
  const data = new Date(iso)
  const agora = new Date()
  const diff = agora.getTime() - data.getTime()

  const minutos = Math.floor(diff / 60000)
  const horas   = Math.floor(diff / 3600000)
  const dias    = Math.floor(diff / 86400000)

  if (minutos < 1)  return 'agora mesmo'
  if (minutos < 60) return `há ${minutos} minuto${minutos > 1 ? 's' : ''}`
  if (horas < 24)   return `há ${horas} hora${horas > 1 ? 's' : ''}`
  if (dias < 7)     return `há ${dias} dia${dias > 1 ? 's' : ''}`
  return formatarData(iso)
}

// Iniciais do nome: "Maria da Silva" → "MS"
export function iniciais(nome: string): string {
  return nome
    .split(' ')
    .filter(p => p.length > 2)
    .map(p => p[0].toUpperCase())
    .slice(0, 2)
    .join('')
}

// Trunca texto longo
export function truncar(texto: string, max = 80): string {
  if (texto.length <= max) return texto
  return texto.slice(0, max).trimEnd() + '…'
}
