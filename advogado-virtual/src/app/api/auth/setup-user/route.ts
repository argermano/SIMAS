import { NextResponse } from 'next/server'

// Endpoint DESATIVADO.
// O registro público foi descontinuado (src/app/(auth)/registro redireciona para /login):
// novos usuários são criados por convite em Configurações > Equipe, que já valida
// auth/tenant/role. Este endpoint criava tenant + usuário via service_role SEM
// autenticação (qualquer um podia criar tenants/usuários), então fica bloqueado.
export async function POST() {
  return NextResponse.json(
    { error: 'Cadastro público desativado. Novos usuários são criados por convite.' },
    { status: 410 }
  )
}
