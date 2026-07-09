import { z } from 'zod'

/**
 * Validação centralizada de variáveis de ambiente.
 *
 * - Obrigatórias: o app não funciona sem elas → falha no boot (instrumentation.ts).
 * - Opcionais (feature-gated): apenas geram aviso quando ausentes; a feature
 *   correspondente é desativada/erra em runtime com mensagem clara.
 *
 * Para consumir com tipos garantidos, use serverEnv() (lança se inválida).
 */

const serverSchema = z.object({
  // ── Obrigatórias ───────────────────────────────────────────────
  NEXT_PUBLIC_SUPABASE_URL: z.string().url('NEXT_PUBLIC_SUPABASE_URL deve ser uma URL válida'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY ausente'),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, 'SUPABASE_SERVICE_ROLE_KEY ausente'),
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, 'ANTHROPIC_API_KEY ausente')
    .refine((v) => !v.includes('PREENCHA'), 'ANTHROPIC_API_KEY não configurada (placeholder)'),

  // ── Opcionais (feature-gated) ──────────────────────────────────
  ANTHROPIC_MODEL: z.string().optional(),
  ANTHROPIC_MAX_TOKENS: z.string().optional(),
  GROQ_API_KEY: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  DATAJUD_API_KEY: z.string().optional(),
  D4SIGN_TOKEN_API: z.string().optional(),
  D4SIGN_CRYPT_KEY: z.string().optional(),
  D4SIGN_BASE_URL: z.string().optional(),
  D4SIGN_WEBHOOK_SECRET: z.string().optional(),
  RELAY_URL: z.string().optional(),
  RELAY_TOKEN: z.string().optional(),
  CONTACT_REPLY_EMAIL: z.string().optional(),
  NEXT_PUBLIC_SITE_URL: z.string().optional(),
  NEXTAUTH_URL: z.string().optional(),
})

export type ServerEnv = z.infer<typeof serverSchema>

/** Vars opcionais cuja ausência desativa uma feature — usadas para avisos no boot. */
export const FEATURE_VARS: Record<string, string> = {
  GROQ_API_KEY: 'transcrição de áudio (Whisper)',
  RESEND_API_KEY: 'envio de e-mails',
  // ENCRYPTION_KEY tem tratamento próprio (com enforcement opt-in) em instrumentation.ts.
  D4SIGN_TOKEN_API: 'assinatura digital (D4Sign)',
  D4SIGN_WEBHOOK_SECRET: 'validação do webhook D4Sign',
}

/** Faz o safeParse de process.env contra o schema (não lança). */
export function validateEnv() {
  return serverSchema.safeParse(process.env)
}

let cached: ServerEnv | null = null

/** Retorna o env validado e tipado. Lança se alguma obrigatória estiver ausente/ inválida. */
export function serverEnv(): ServerEnv {
  if (!cached) {
    const parsed = serverSchema.safeParse(process.env)
    if (!parsed.success) {
      const fieldErrors = parsed.error.flatten().fieldErrors
      throw new Error(`Variáveis de ambiente inválidas: ${JSON.stringify(fieldErrors)}`)
    }
    cached = parsed.data
  }
  return cached
}
