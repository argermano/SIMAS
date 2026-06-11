import { NextResponse } from 'next/server'
import type { z } from 'zod'

/**
 * Helpers de resposta e validação para rotas de API.
 * Padroniza o formato de erro: { error: string, detalhes?: ... }
 */

export function jsonError(message: string, status: number, detalhes?: unknown): NextResponse {
  return NextResponse.json(
    detalhes === undefined ? { error: message } : { error: message, detalhes },
    { status }
  )
}

export type ValidationResult<T> =
  | { ok: true; data: T }
  | { ok: false; response: NextResponse }

/**
 * Faz o parse + validação Zod do corpo JSON da requisição.
 * Retorna 400 padronizado em corpo inválido ou schema incompatível.
 *
 *   const parsed = await validateBody(req, schema)
 *   if (!parsed.ok) return parsed.response
 *   const dados = parsed.data
 */
export async function validateBody<T extends z.ZodTypeAny>(
  req: Request,
  schema: T,
): Promise<ValidationResult<z.infer<T>>> {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return { ok: false, response: jsonError('Corpo da requisição inválido (JSON malformado)', 400) }
  }

  const parsed = schema.safeParse(body)
  if (!parsed.success) {
    return { ok: false, response: jsonError('Dados inválidos', 400, parsed.error.flatten()) }
  }

  return { ok: true, data: parsed.data }
}
