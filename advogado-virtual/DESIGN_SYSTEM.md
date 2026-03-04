# Design System — SIMAS (Sistema Jurídico)

## Identidade
- **Nome:** SIMAS — Sistema Jurídico
- **Tom:** Profissional, limpo, moderno
- **Tema:** Azul profissional (índigo profundo)

## Cores
- Primária: #3B4FCC (azul-índigo) | Glow: #7B6FF0
- Background: #F5F6F8 | Cards: #FFFFFF
- Texto: #1D2335 | Texto muted: #737D8C
- Bordas: #DDE1E9
- Sucesso: #2DB877 | Alerta: #F5A623 | Info: #2BA4E6 | Erro: #D94040
- Sidebar: #141B4D (fundo) | #262F66 (item ativo)

## Tipografia
- Headings: Plus Jakarta Sans (500-800)
- Body: Inter (300-800)

## Sidebar
- Gradiente azul escuro com framer-motion para colapso/expansão
- Indicador animado no item ativo (barra lateral + fundo com spring animation)
- Tooltips no modo colapsado
- Gradiente no avatar e logo
- Label "MENU" em uppercase muted
- Status online (bolinha verde no avatar)
- Botão de logout + toggle de colapso

## Cards
- bg-card rounded-xl border shadow-card
- Hover: shadow-card-hover + border-primary/20
- Entrada: animate-fade-in escalonado

## Ícones por Área Jurídica
- Previdenciário: azul-índigo (primary)
- Trabalhista: verde (success)
- Cível: azul claro (info)
- Criminal: vermelho (destructive)
- Tributário: laranja (warning)
- Empresarial: teal (#0ea5e9)

## Regras
- Sempre usar componentes de @/components/ui (shadcn/ui pattern)
- Animações com framer-motion (sidebar, modais)
- Entrada de cards com animate-fade-in + delay escalonado
- Gradientes usam primary → primary-glow (135deg)
- Usar tokens CSS variables via hsl(var(--xxx)) — nunca hex hardcoded
