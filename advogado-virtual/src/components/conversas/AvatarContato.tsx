'use client'

import { useState } from 'react'
import { cn, iniciais } from '@/lib/utils'

/**
 * Avatar do contato: mostra a foto (thumbnail do Chatwoot / foto de perfil do
 * WhatsApp) quando houver; senão, cai nas iniciais. Se a imagem falhar ao carregar
 * (URL expirada, sem permissão), também cai nas iniciais — nunca fica quebrado.
 * `className` controla o tamanho (ex.: "h-10 w-10").
 */
export function AvatarContato({
  nome,
  avatarUrl,
  className,
}: {
  nome: string
  avatarUrl?: string | null
  className?: string
}) {
  const [erro, setErro] = useState(false)
  const mostrarFoto = !!avatarUrl && !erro

  return (
    <span
      aria-hidden
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 text-sm font-bold text-primary',
        className,
      )}
    >
      {mostrarFoto ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl as string}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setErro(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        iniciais(nome)
      )}
    </span>
  )
}
