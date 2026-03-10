import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// POST /api/extrair-texto — extrai texto de um arquivo (PDF) enviado via FormData
export async function POST(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'Arquivo não enviado' }, { status: 400 })

  const arrayBuffer = await file.arrayBuffer()
  let texto = ''

  if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
    try {
      const pdfMod = await import('pdf-parse')
      const pdfParse = (pdfMod as unknown as { default: (buf: Buffer) => Promise<{ text: string }> }).default ?? pdfMod
      const buffer = Buffer.from(arrayBuffer)
      const pdfData = await (pdfParse as (buf: Buffer) => Promise<{ text: string }>)(buffer)
      texto = pdfData.text ?? ''
    } catch {
      texto = ''
    }
  } else if (file.type === 'text/plain' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
    texto = new TextDecoder().decode(arrayBuffer)
  }

  return NextResponse.json({ texto })
}
