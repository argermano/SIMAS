import Link from 'next/link'
import { Scale, ArrowLeft } from 'lucide-react'

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
        <Scale className="h-8 w-8 text-primary" />
      </div>
      <h1 className="text-4xl font-bold text-foreground">404</h1>
      <h2 className="mt-2 text-xl font-semibold text-foreground">Página não encontrada</h2>
      <p className="mt-2 max-w-md text-muted-foreground">
        A página que você está procurando não existe ou foi removida.
      </p>
      <Link
        href="/dashboard"
        className="mt-8 inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-base font-semibold text-white hover:bg-primary/90 transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Voltar ao início
      </Link>
    </main>
  )
}
