import { redirect } from 'next/navigation'

// Redireciona raiz para o dashboard (ou login via middleware)
export default function Home() {
  redirect('/dashboard')
}
