'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  Brain,
  FileText,
  Users,
  Mic,
  ShieldCheck,
  ArrowRight,
  Lock,
  Zap,
  ChevronRight,
  PenTool,
  BookOpen,
  Gavel,
  FileSignature,
  BadgeCheck,
  ScrollText,
  ClipboardCheck,
  Building2,
  MessagesSquare,
  Radar,
  Newspaper,
  CalendarClock,
  FolderTree,
  Wallet,
  KanbanSquare,
  KeyRound,
  Menu,
  X,
} from 'lucide-react'

/* ─── Animated counter hook ──────────────────────────────── */

function useCountUp(end: number, duration = 2000, startOnView = true) {
  const [count, setCount] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  useEffect(() => {
    if (!startOnView) return
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !started.current) {
          started.current = true
          const startTime = performance.now()
          const animate = (now: number) => {
            const elapsed = now - startTime
            const progress = Math.min(elapsed / duration, 1)
            const eased = 1 - Math.pow(1 - progress, 3)
            setCount(Math.round(eased * end))
            if (progress < 1) requestAnimationFrame(animate)
          }
          requestAnimationFrame(animate)
        }
      },
      { threshold: 0.3 }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [end, duration, startOnView])

  return { count, ref }
}

/* ─── Scroll-reveal wrapper ──────────────────────────────── */

function Reveal({
  children,
  className = '',
  delay = 0,
}: {
  children: React.ReactNode
  className?: string
  delay?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { threshold: 0.15 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(32px)',
        transition: `opacity 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms, transform 0.7s cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms`,
      }}
    >
      {children}
    </div>
  )
}

/* ─── Data ─────────────────────────────────────────────── */

// Cobre coeso (sem arco-íris): todos os pontos usam o mesmo gradiente café.
const AREAS = [
  'Previdenciário',
  'Trabalhista',
  'Família',
  'Empresarial',
  'Médico',
  'Cível',
  'Criminal',
  'Tributário',
]

const WORKFLOW_STEPS = [
  {
    icon: Mic,
    title: 'Grave a consulta',
    description: 'Registre o atendimento com áudio. A IA transcreve automaticamente em segundos via Groq — rápido e resiliente.',
  },
  {
    icon: Brain,
    title: 'Análise inteligente',
    description: 'A IA analisa o caso, identifica riscos, sugere estratégias e monta um plano de provas completo.',
  },
  {
    icon: PenTool,
    title: 'Gere a peça processual',
    description: 'Petições, contestações, apelações — geradas com base na transcrição, documentos e jurisprudência.',
  },
  {
    icon: FileSignature,
    title: 'Revise e assine',
    description: 'Editor jurídico ABNT, exportação DOCX/PDF e assinatura digital integrada via D4Sign.',
  },
]

// Módulos de gestão do escritório — o SIMAS além da geração de peças.
const GESTAO = [
  {
    icon: MessagesSquare,
    title: 'Conversas em um só lugar',
    description:
      'O WhatsApp do escritório centralizado. O assistente virtual faz triagem e agendamento e transfere para a equipe — quando a atendente assume, a IA se cala.',
  },
  {
    icon: Radar,
    title: 'Acompanhamento processual',
    description:
      'Publicações do DJEN e andamentos do DataJud chegam sozinhos. Linha do tempo por processo com resumo em linguagem clara — e o cliente pergunta pelo WhatsApp e recebe a situação real.',
  },
  {
    icon: Newspaper,
    title: 'Publicações com IA',
    description:
      'A caixa de publicações sugere o tratamento e destaca a data. Nada vira prazo sem confirmação humana — o controle continua com o advogado.',
  },
  {
    icon: CalendarClock,
    title: 'Agenda conectada',
    description:
      'Compromissos, prazos e audiências no Google Agenda de cada advogado, automaticamente, com convites por e-mail aos envolvidos.',
  },
  {
    icon: FolderTree,
    title: 'Documentos como um Drive',
    description:
      'O dossiê do cliente em árvore — casos, processos, contratos. O mesmo documento em várias pastas, espelhado no Google Drive do escritório.',
  },
  {
    icon: Wallet,
    title: 'Financeiro do caso',
    description:
      'Parcelas e previsão de recebimento nascem do contrato. O comprovante chega pelo WhatsApp e a baixa é automática quando o pagamento confere — na dúvida, quem decide é gente.',
  },
  {
    icon: KanbanSquare,
    title: 'Funil comercial',
    description:
      'Cada conversa nova vira card no kanban. As consultas agendadas pelo assistente já aparecem na agenda.',
  },
  {
    icon: FileSignature,
    title: 'Contratos',
    description:
      'Geração, assinatura digital via D4Sign e previsão financeira no mesmo fluxo.',
  },
]

const FEATURES = [
  {
    icon: BadgeCheck,
    title: 'Fundamentação verificada',
    description:
      'Citações conferidas automaticamente — números de processo (CNJ), súmulas e leis — com verificação online (LexML/DataJud). Menos alucinação, mais confiança.',
  },
  {
    icon: ScrollText,
    title: 'Teses do seu escritório',
    description:
      'Envie peças do escritório: a IA extrai as teses, o advogado aprova e só a tese aprovada entra na fundamentação.',
  },
  {
    icon: ClipboardCheck,
    title: 'Revisão anti-alucinação',
    description:
      'Painel “Revisar peça” com diferença e aceite por seção e autosave — você confere cada trecho antes de assinar.',
  },
  {
    icon: FileText,
    title: 'Da consulta à peça',
    description:
      'Petições, contestações e recursos gerados a partir da transcrição, dos documentos e da jurisprudência — no editor jurídico ABNT.',
  },
  {
    icon: Users,
    title: 'Histórico do caso',
    description:
      'Atendimentos, análises e peças de cada cliente reunidos — o caso inteiro à mão na hora de redigir.',
  },
  {
    icon: ShieldCheck,
    title: 'Segurança & multi-tenancy',
    description:
      'Dados isolados por escritório com RLS, criptografia, LGPD e controle de acesso por perfil.',
  },
]

const DIFERENCIAIS = [
  {
    icon: Building2,
    title: 'Proximidade',
    content:
      'Feito dentro de um escritório real, em piloto — nascido da rotina da advocacia, não de um laboratório.',
  },
  {
    icon: Gavel,
    title: 'Técnica',
    content:
      'Para o direito brasileiro, no padrão forense — peças, prazos e linguagem que o foro reconhece.',
  },
  {
    icon: BadgeCheck,
    title: 'Transparência',
    content:
      'Fundamentação que você confere — citações verificadas e teses aprovadas pelo escritório.',
  },
]

const STATS: { value?: number; suffix?: string; text?: string; label: string }[] = [
  { value: 8, label: 'áreas do direito' },
  { value: 20, label: 'combinações de prompts curados (área × tipo de peça)' },
  { text: 'Citações', label: 'conferidas: nº CNJ, súmulas e leis' },
  { text: 'Teses', label: 'do escritório na fundamentação' },
  { text: 'DJEN', label: 'publicações conferidas diariamente' },
  { text: 'Google', label: 'Agenda e Drive espelhados automaticamente' },
]

const TRUST = [
  { icon: Lock, title: 'LGPD & isolamento por escritório', desc: 'Dados isolados por RLS e criptografados' },
  { icon: BadgeCheck, title: 'Fundamentação verificada', desc: 'Citações conferidas: nº CNJ, súmulas e leis' },
  { icon: KeyRound, title: 'Acesso mínimo no Google', desc: 'O app só acessa a agenda e as pastas que ele mesmo criou' },
  { icon: Building2, title: 'Feito em escritório real', desc: 'Desenvolvido na rotina da advocacia (SC/DF)' },
]

/* ─── Stat Card with animated counter ───────────────────── */

function StatCard({ value, suffix = '', text, label }: { value?: number; suffix?: string; text?: string; label: string }) {
  const { count, ref } = useCountUp(value ?? 0, 2200)
  return (
    <div ref={ref} className="text-center">
      <p className="font-heading text-3xl font-bold text-white md:text-4xl lg:text-5xl">
        {value !== undefined ? (
          <>
            {count}
            <span className="text-white/70">{suffix}</span>
          </>
        ) : (
          text
        )}
      </p>
      <p className="mt-2 text-sm font-medium text-white/60">{label}</p>
    </div>
  )
}

/* ─── Contact form (piloto) — posta em /api/contato ─────── */

function ContatoForm() {
  const [dados, setDados] = useState({ nome: '', email: '', telefone: '', website: '' })
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!dados.nome.trim() || !dados.email.trim()) return
    setEnviando(true)
    setErro(null)
    try {
      const res = await fetch('/api/contato', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dados),
      })
      if (res.ok) {
        setEnviado(true)
      } else {
        setErro('Não foi possível enviar agora. Tente novamente ou escreva para atendimento@apoiojuridicodf.adv.br.')
      }
    } catch {
      setErro('Falha de rede. Tente novamente em instantes.')
    } finally {
      setEnviando(false)
    }
  }

  if (enviado) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-8 text-center shadow-card">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-primary">
          <BadgeCheck className="h-6 w-6" />
        </div>
        <h3 className="font-heading text-2xl font-bold text-foreground">Recebemos seu contato</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          Obrigado pelo interesse. Respondemos no e-mail informado assim que possível.
        </p>
      </div>
    )
  }

  const inputClass =
    'w-full rounded-lg border border-input bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary/60 focus:ring-2 focus:ring-ring/20 transition-colors disabled:opacity-50'

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-border/60 bg-card p-6 shadow-card sm:p-8" noValidate>
      {/* Honeypot anti-bot — deve permanecer vazio */}
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={dados.website}
        onChange={(e) => setDados((p) => ({ ...p, website: e.target.value }))}
        className="hidden"
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <input
          type="text"
          required
          placeholder="Seu nome"
          value={dados.nome}
          onChange={(e) => setDados((p) => ({ ...p, nome: e.target.value }))}
          disabled={enviando}
          className={inputClass}
        />
        <input
          type="email"
          required
          placeholder="Seu e-mail"
          value={dados.email}
          onChange={(e) => setDados((p) => ({ ...p, email: e.target.value }))}
          disabled={enviando}
          className={inputClass}
        />
      </div>
      <input
        type="tel"
        placeholder="Telefone (opcional)"
        value={dados.telefone}
        onChange={(e) => setDados((p) => ({ ...p, telefone: e.target.value }))}
        disabled={enviando}
        className={`${inputClass} mt-4`}
      />
      {erro && <p className="mt-4 text-sm text-destructive">{erro}</p>}
      <button
        type="submit"
        disabled={enviando || !dados.nome.trim() || !dados.email.trim()}
        className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-primary to-primary-glow px-6 py-3 text-sm font-bold text-white shadow-lg shadow-primary/25 transition-all hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:translate-y-0"
      >
        {enviando ? 'Enviando…' : 'Fale com a gente'}
        {!enviando && <ArrowRight className="h-4 w-4" />}
      </button>
      <p className="mt-4 text-center text-xs text-muted-foreground">
        Prefere e-mail? Escreva para{' '}
        <a
          href="mailto:atendimento@apoiojuridicodf.adv.br"
          className="font-semibold text-primary underline underline-offset-2"
        >
          atendimento@apoiojuridicodf.adv.br
        </a>
      </p>
    </form>
  )
}

/* ─── Page ─────────────────────────────────────────────── */

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const NAV_LINKS: [string, string][] = [
    ['#workflow', 'Como funciona'],
    ['#gestao', 'Gestão'],
    ['#features', 'Funcionalidades'],
    ['#contato', 'Contato'],
    ['#diferenciais', 'Diferenciais'],
  ]

  return (
    <div className="landing-brand min-h-screen bg-background text-foreground overflow-x-hidden">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            '@context': 'https://schema.org',
            '@type': 'SoftwareApplication',
            name: 'SIMAS',
            applicationCategory: 'BusinessApplication',
            operatingSystem: 'Web',
            inLanguage: 'pt-BR',
            url: 'https://simas.app',
            description:
              'Sistema de gestão jurídica com IA para a advocacia brasileira — do primeiro contato no WhatsApp à peça assinada, com fundamentação verificada.',
          }),
        }}
      />
      {/* ═══════════ Navbar ═══════════ */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5 group">
            {/* Marca oficial (logo do dono, 2026-07-16): símbolo navy no claro, branco no escuro. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- asset estático de public/ */}
            <img src="/marca-s-navy.png" alt="" className="h-9 w-auto dark:hidden" />
            {/* eslint-disable-next-line @next/next/no-img-element -- asset estático de public/ */}
            <img src="/marca-s-branca.png" alt="" className="hidden h-9 w-auto dark:block" />
            <span className="font-heading text-xl font-semibold tracking-tight">
              SIMAS
            </span>
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            {NAV_LINKS.map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="relative text-sm font-medium text-muted-foreground transition-colors hover:text-foreground after:absolute after:-bottom-1 after:left-0 after:h-0.5 after:w-0 after:rounded-full after:bg-primary after:transition-all hover:after:w-full"
              >
                {label}
              </a>
            ))}
          </div>

          <div className="hidden items-center gap-3 md:flex">
            <Link
              href="/login"
              className="rounded-lg px-4 py-2 text-sm font-semibold text-muted-foreground transition-all hover:text-foreground hover:bg-muted"
            >
              Entrar
            </Link>
            <a
              href="#contato"
              className="group relative rounded-lg bg-gradient-to-r from-primary to-primary-glow px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5"
            >
              Fale com a gente
              <ArrowRight className="ml-1.5 inline-block h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </a>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border bg-card md:hidden"
            aria-label="Menu"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="border-t bg-card px-5 py-4 md:hidden">
            <div className="flex flex-col gap-3">
              {NAV_LINKS.map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setMobileMenuOpen(false)}
                  className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  {label}
                </a>
              ))}
              <div className="mt-2 flex gap-3 border-t pt-3">
                <Link href="/login" className="text-sm font-semibold text-muted-foreground">Entrar</Link>
                <a href="#contato" onClick={() => setMobileMenuOpen(false)} className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white">Fale com a gente</a>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Spacer for fixed navbar */}
      <div className="h-[60px]" />

      {/* ═══════════ Hero ═══════════ */}
      <section className="relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/[0.04] via-transparent to-transparent" />
          <div className="absolute left-1/2 top-0 -translate-x-1/2 h-[600px] w-[900px] rounded-full bg-primary/[0.06] blur-[120px]" />
          <div className="absolute right-0 top-20 h-[300px] w-[300px] rounded-full bg-accent/[0.05] blur-[80px]" />
          {/* Subtle grid */}
          <div
            className="absolute inset-0 opacity-[0.03]"
            style={{
              backgroundImage:
                'linear-gradient(hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground)) 1px, transparent 1px)',
              backgroundSize: '64px 64px',
            }}
          />
        </div>

        <div className="relative mx-auto max-w-7xl px-5 pb-20 pt-16 sm:px-8 sm:pt-24 md:pt-28">
          <Reveal>
            <div className="mx-auto max-w-4xl text-center">
              {/* Badge */}
              <div className="eyebrow-cinzel mx-auto mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-accent/10 px-4 py-2 text-xs font-semibold uppercase text-primary backdrop-blur-sm">
                <BadgeCheck className="h-4 w-4" />
                IA com fundamentação verificada
                <ChevronRight className="h-3.5 w-3.5 opacity-60" />
              </div>

              {/* Headline */}
              <h1 className="font-serif text-4xl font-semibold leading-[1.08] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
                Todo o escritório em um sistema,{' '}
                <span className="relative">
                  <span className="bg-gradient-to-r from-primary via-primary-glow to-primary bg-clip-text text-transparent">
                    da consulta à peça assinada
                  </span>
                  <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" fill="none">
                    <path
                      d="M2 8.5C50 3 100 2 150 5C200 8 250 4 298 6"
                      stroke="hsl(var(--primary))"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeOpacity="0.35"
                    />
                  </svg>
                </span>
              </h1>

              <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
                Do primeiro contato no WhatsApp ao financeiro do caso: atendimento, processos, agenda e
                documentos em um só lugar — com a geração de peças de{' '}
                <span className="font-semibold text-primary">fundamentação verificada</span> no coração.
              </p>

              {/* CTA buttons */}
              <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                <a
                  href="#contato"
                  className="group relative inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-primary to-primary-glow px-8 py-4 text-base font-bold text-white shadow-xl shadow-primary/25 transition-all hover:shadow-2xl hover:shadow-primary/30 hover:-translate-y-0.5"
                >
                  Fale com a gente
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </a>
                <a
                  href="#workflow"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card/80 px-8 py-4 text-base font-semibold text-foreground shadow-sm backdrop-blur-sm transition-all hover:bg-card hover:shadow-md"
                >
                  <BookOpen className="h-5 w-5 text-muted-foreground" />
                  Como funciona
                </a>
              </div>
            </div>
          </Reveal>

          {/* Areas pills */}
          <Reveal delay={200}>
            <div className="mx-auto mt-16 flex max-w-3xl flex-wrap items-center justify-center gap-2.5">
              {AREAS.map((area) => (
                <span
                  key={area}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-4 py-1.5 text-sm font-medium text-foreground shadow-sm backdrop-blur-sm"
                >
                  <span className="h-2 w-2 rounded-full bg-gradient-to-r from-primary to-primary-glow" />
                  {area}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ Stats bar ═══════════ */}
      <section className="relative overflow-hidden border-y border-white/10 bg-gradient-to-r from-[#2A1D18] via-[#241A15] to-[#1E1411]">
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }} />
        <div className="relative mx-auto max-w-5xl px-5 py-14 sm:px-8">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-3">
            {STATS.map((s) => (
              <StatCard key={s.label} value={s.value} suffix={s.suffix} text={s.text} label={s.label} />
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ Workflow ═══════════ */}
      <section id="workflow" className="relative py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Reveal>
            <div className="text-center">
              <span className="eyebrow-cinzel inline-block rounded-full bg-accent/15 px-4 py-1.5 text-xs font-semibold uppercase text-primary">
                Como funciona
              </span>
              <h2 className="mt-5 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
                Da consulta à peça,{' '}
                <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">com fundamentação</span>
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                Quatro passos conectados — o relato do cliente vira transcrição, análise e minuta, tudo no dossiê.
              </p>
            </div>
          </Reveal>

          <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW_STEPS.map((step, i) => {
              const Icon = step.icon
              return (
                <Reveal key={step.title} delay={i * 100}>
                  <div className="group relative flex flex-col rounded-xl border border-border/60 bg-card p-7 shadow-card transition-all hover:shadow-card-hover hover:-translate-y-1 hover:border-primary/20">
                    {/* Step number */}
                    <div className="eyebrow-cinzel absolute -top-3.5 left-6 flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-glow text-xs font-bold text-white shadow-md shadow-primary/25">
                      {i + 1}
                    </div>

                    <div className="mb-5 mt-2 flex h-14 w-14 items-center justify-center rounded-xl bg-accent/10 transition-colors group-hover:bg-accent/20">
                      <Icon className="h-7 w-7 text-primary" />
                    </div>

                    <h3 className="font-heading text-xl font-semibold text-foreground">{step.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.description}</p>

                    {/* Connector line (not on last) */}
                    {i < WORKFLOW_STEPS.length - 1 && (
                      <div className="absolute -right-3 top-1/2 hidden h-px w-6 bg-border lg:block" />
                    )}
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* ═══════════ Gestão do escritório ═══════════ */}
      <section id="gestao" className="relative border-t py-24 md:py-32">
        {/* Subtle background glow */}
        <div className="absolute right-0 top-1/3 h-[380px] w-[380px] rounded-full bg-primary/[0.04] blur-[100px]" />

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <Reveal>
            <div className="text-center">
              <span className="eyebrow-cinzel inline-block rounded-full bg-accent/15 px-4 py-1.5 text-xs font-semibold uppercase text-primary">
                Gestão do escritório
              </span>
              <h2 className="mt-5 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
                Além da peça,{' '}
                <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">o escritório inteiro</span>
              </h2>
              <p className="mx-auto mt-4 max-w-2xl text-muted-foreground">
                Atendimento, processos, agenda, documentos e financeiro no mesmo lugar da geração de
                peças — cada rotina puxa a seguinte, sempre com a palavra final do advogado.
              </p>
            </div>
          </Reveal>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {GESTAO.map((m, i) => {
              const Icon = m.icon
              return (
                <Reveal key={m.title} delay={(i % 4) * 80}>
                  <div className="group relative flex h-full flex-col rounded-xl border border-border/60 bg-card p-6 shadow-card transition-all hover:shadow-card-hover hover:-translate-y-1 hover:border-primary/20">
                    <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-primary transition-transform group-hover:scale-110">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-heading text-base font-semibold text-foreground">{m.title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{m.description}</p>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* ═══════════ Features ═══════════ */}
      <section id="features" className="relative border-t bg-muted/20 py-24 md:py-32">
        {/* Subtle background glow */}
        <div className="absolute left-0 top-1/2 h-[400px] w-[400px] -translate-y-1/2 rounded-full bg-accent/[0.04] blur-[100px]" />

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <Reveal>
            <div className="text-center">
              <span className="eyebrow-cinzel inline-block rounded-full bg-accent/15 px-4 py-1.5 text-xs font-semibold uppercase text-primary">
                Funcionalidades
              </span>
              <h2 className="mt-5 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
                O coração: a peça que se sustenta
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                Citações conferidas, teses do escritório e revisão trecho a trecho — para você assinar com segurança.
              </p>
            </div>
          </Reveal>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => {
              const Icon = f.icon
              return (
                <Reveal key={f.title} delay={i * 80}>
                  <div className="group relative flex flex-col rounded-xl border border-border/60 bg-card p-7 shadow-card transition-all hover:shadow-card-hover hover:-translate-y-1 hover:border-primary/20 h-full">
                    <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-primary transition-transform group-hover:scale-110">
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="font-heading text-xl font-semibold text-foreground">{f.title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                  </div>
                </Reveal>
              )
            })}
          </div>

          {/* Three pillars */}
          <Reveal delay={200}>
            <div className="mt-16 rounded-xl border border-primary/10 bg-gradient-to-br from-accent/[0.06] to-transparent p-8 md:p-12">
              <h3 className="text-center font-heading text-2xl font-semibold text-foreground">
                Três frentes, por área jurídica
              </h3>
              <div className="mt-8 grid gap-6 md:grid-cols-3">
                {[
                  {
                    icon: Zap,
                    title: 'Peças com IA',
                    desc: 'Petição, Contestação, Réplica, Apelação, Agravo, Embargos — geradas e refinadas com inteligência artificial.',
                  },
                  {
                    icon: FileText,
                    title: 'Modelos prontos',
                    desc: 'Procuração, Contrato de Honorários, Substabelecimento, Declarações — templates do escritório sempre à mão.',
                  },
                  {
                    icon: Brain,
                    title: 'Consultoria IA',
                    desc: 'Análise de caso, parecer jurídico, estratégia processual e plano de provas — em linguagem acessível.',
                  },
                ].map((pillar) => {
                  const Icon = pillar.icon
                  return (
                    <div key={pillar.title} className="flex flex-col items-center text-center">
                      <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-accent/15 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <h4 className="font-heading text-lg font-semibold text-foreground">{pillar.title}</h4>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.desc}</p>
                    </div>
                  )
                })}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ Contato / Piloto ═══════════ */}
      <section id="contato" className="relative border-t py-24 md:py-32">
        <div className="mx-auto max-w-3xl px-5 sm:px-8">
          <Reveal>
            <div className="text-center">
              <span className="eyebrow-cinzel inline-block rounded-full bg-accent/15 px-4 py-1.5 text-xs font-semibold uppercase text-primary">
                Contato
              </span>
              <h2 className="mt-5 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
                Quer mais informações?
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                Entre em contato conosco — deixe seus dados abaixo que a gente responde.
              </p>
            </div>
          </Reveal>

          <Reveal delay={120}>
            <div className="mx-auto mt-12 max-w-xl">
              <ContatoForm />
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ Diferenciais ═══════════ */}
      <section id="diferenciais" className="relative border-t bg-muted/20 py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Reveal>
            <div className="text-center">
              <span className="eyebrow-cinzel inline-block rounded-full bg-accent/15 px-4 py-1.5 text-xs font-semibold uppercase text-primary">
                Diferenciais
              </span>
              <h2 className="mt-5 font-serif text-3xl font-semibold text-foreground md:text-4xl lg:text-5xl">
                Três compromissos com o seu escritório
              </h2>
            </div>
          </Reveal>

          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {DIFERENCIAIS.map((d, i) => {
              const Icon = d.icon
              return (
                <Reveal key={d.title} delay={i * 100}>
                  <div className="flex h-full flex-col rounded-xl border border-border/60 bg-card p-7 shadow-card transition-all hover:shadow-card-hover hover:-translate-y-1">
                    <div className="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent/15 text-primary">
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="font-heading text-xl font-semibold text-foreground">{d.title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{d.content}</p>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* ═══════════ CTA ═══════════ */}
      <section className="relative overflow-hidden border-t">
        <div className="absolute inset-0 bg-gradient-to-br from-[#241A15] via-[#2A1D18] to-[#1E1411]" />
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }} />
        {/* Glow */}
        <div className="absolute left-1/2 top-0 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent/20 blur-[100px]" />

        <div className="relative mx-auto max-w-3xl px-5 py-20 text-center sm:px-8 md:py-28">
          <Reveal>
            <div className="eyebrow-cinzel mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-semibold uppercase text-white/80 backdrop-blur-sm">
              <Gavel className="h-4 w-4" />
              Piloto aberto a conversas
            </div>

            <h2 className="font-serif text-3xl font-semibold text-white md:text-4xl lg:text-5xl">
              Vamos conversar sobre{' '}
              <span className="bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                o seu escritório
              </span>
            </h2>

            <p className="mx-auto mt-6 max-w-xl text-lg text-white/60">
              O SIMAS está em piloto, feito dentro de um escritório real. Se faz sentido para a sua
              advocacia, escreva para a gente.
            </p>

            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <a
                href="#contato"
                className="group inline-flex items-center gap-2 rounded-xl bg-white px-8 py-4 text-base font-bold text-primary shadow-xl transition-all hover:shadow-2xl hover:-translate-y-0.5"
              >
                Fale com a gente
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </a>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ Trust badges ═══════════ */}
      <section className="border-t py-14">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {TRUST.map((t, i) => {
              const Icon = t.icon
              return (
                <Reveal key={t.title} delay={i * 80}>
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">{t.title}</p>
                      <p className="text-xs text-muted-foreground">{t.desc}</p>
                    </div>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </div>
      </section>

      {/* ═══════════ Footer ═══════════ */}
      <footer className="border-t bg-muted/20 py-8">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- asset estático de public/ */}
              <img src="/marca-s-navy.png" alt="" className="h-8 w-auto dark:hidden" />
              {/* eslint-disable-next-line @next/next/no-img-element -- asset estático de public/ */}
              <img src="/marca-s-branca.png" alt="" className="hidden h-8 w-auto dark:block" />
              <span className="font-heading text-base font-semibold">SIMAS</span>
            </div>
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} SIMAS — Sistema Jurídico · Em piloto (SC/DF). Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
