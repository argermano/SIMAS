import { Fraunces } from 'next/font/google'

/**
 * Serifada display usada SOMENTE no título "Agenda." da tela /agenda.
 * Não altera a fonte global do app (layout.tsx segue com Google Fonts via <link>).
 */
export const fonteDisplay = Fraunces({
  subsets: ['latin'],
  display: 'swap',
  weight: ['600', '700'],
  fallback: ['Lora', 'Georgia', 'serif'],
})
