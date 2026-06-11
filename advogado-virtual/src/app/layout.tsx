import type { Metadata } from 'next'
import './globals.css'
import { ToastProvider } from '@/components/ui/toast'
import { HashTokenHandler } from '@/components/auth/HashTokenHandler'

export const metadata: Metadata = {
  metadataBase: new URL('https://simas.app'),
  title: {
    default:  'SIMAS — Sistema jurídico inteligente com IA',
    template: '%s | SIMAS',
  },
  description:
    'Analise casos com IA, gere peças processuais no padrão ABNT, transcreva consultas e organize o escritório — em minutos. Plataforma jurídica para a advocacia brasileira.',
  applicationName: 'SIMAS',
  authors: [{ name: 'SIMAS' }],
  keywords: [
    'advocacia', 'SaaS jurídico', 'IA jurídica', 'inteligência artificial jurídica',
    'peças processuais', 'petição', 'análise de casos', 'transcrição de áudio',
    'gestão de escritório de advocacia', 'ABNT', 'LGPD', 'Brasil',
  ],
  openGraph: {
    type: 'website',
    locale: 'pt_BR',
    url: 'https://simas.app',
    siteName: 'SIMAS',
    title: 'SIMAS — Sistema jurídico inteligente com IA',
    description:
      'Analise casos com IA, gere peças processuais e organize o escritório — em minutos.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'SIMAS — Sistema jurídico inteligente com IA',
    description:
      'Analise casos com IA, gere peças processuais e organize o escritório — em minutos.',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Lora:wght@500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <ToastProvider>
          <HashTokenHandler />
          {children}
        </ToastProvider>
      </body>
    </html>
  )
}
