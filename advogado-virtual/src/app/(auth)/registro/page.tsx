import { redirect } from 'next/navigation'

// Registro público desabilitado — novos usuários são criados por convite via Configurações > Equipe
export default function RegistroPage() {
  redirect('/login')
}
