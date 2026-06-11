import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { jsonError } from '@/lib/api'
import { buscarJurisprudencia } from '@/lib/jurisprudencia/datajud'

// POST /api/jurisprudencia — buscar jurisprudência na API DataJud (CNJ)
export async function POST(req: NextRequest) {
  try {
    const { termos, tribunais } = await req.json()

    if (!termos || !tribunais || !Array.isArray(tribunais) || tribunais.length === 0) {
      return jsonError('termos e tribunais (array) são obrigatórios', 400)
    }

    // Autenticação
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return jsonError('Não autenticado', 401)

    const resultados = await buscarJurisprudencia({
      termos,
      tribunais,
      limite: 5,
    })

    return NextResponse.json({ resultados, total: resultados.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    return jsonError(message, 500)
  }
}
