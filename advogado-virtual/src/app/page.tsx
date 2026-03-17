'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import {
  Scale,
  Brain,
  FileText,
  Users,
  Mic,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
  Check,
  Star,
  ArrowRight,
  Lock,
  Headphones,
  Zap,
  ChevronRight,
  PenTool,
  BookOpen,
  Gavel,
  FileSignature,
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

const AREAS = [
  { name: 'Previdenciário', color: 'from-primary to-primary-glow' },
  { name: 'Trabalhista', color: 'from-emerald-500 to-emerald-400' },
  { name: 'Família', color: 'from-pink-500 to-rose-400' },
  { name: 'Empresarial', color: 'from-cyan-500 to-sky-400' },
  { name: 'Médico', color: 'from-violet-500 to-purple-400' },
  { name: 'Cível', color: 'from-blue-500 to-blue-400' },
  { name: 'Criminal', color: 'from-red-500 to-red-400' },
  { name: 'Tributário', color: 'from-amber-500 to-orange-400' },
]

const WORKFLOW_STEPS = [
  {
    icon: Mic,
    title: 'Grave a consulta',
    description: 'Registre o atendimento com áudio. A IA transcreve automaticamente em segundos via Whisper.',
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

const FEATURES = [
  {
    icon: Brain,
    title: 'IA Jurídica com Claude',
    description: 'Análise de casos, geração de peças e consulta inteligente — IA treinada para o direito brasileiro.',
    accent: 'bg-primary/10 text-primary',
  },
  {
    icon: FileText,
    title: 'Geração de Documentos',
    description: 'Petições, contratos, procurações e pareceres em minutos com modelos personalizáveis por área.',
    accent: 'bg-emerald-500/10 text-emerald-600',
  },
  {
    icon: Mic,
    title: 'Transcrição de Áudio',
    description: 'Grave consultas e receba a transcrição editável automaticamente. O relato do cliente sempre preservado.',
    accent: 'bg-violet-500/10 text-violet-600',
  },
  {
    icon: Users,
    title: 'Dossiê do Cliente',
    description: 'Centralize atendimentos, documentos, análises e peças de cada cliente em um único lugar.',
    accent: 'bg-sky-500/10 text-sky-600',
  },
  {
    icon: LayoutDashboard,
    title: 'Kanban & Tarefas',
    description: 'Organize o fluxo do escritório com quadros visuais, prazos e acompanhamento de andamentos.',
    accent: 'bg-amber-500/10 text-amber-600',
  },
  {
    icon: ShieldCheck,
    title: 'Segurança & Multi-tenancy',
    description: 'Dados isolados por escritório com RLS, criptografia, LGPD e controle de acesso por perfil.',
    accent: 'bg-rose-500/10 text-rose-600',
  },
]

const PLANS = [
  {
    name: 'Essencial',
    description: 'Para advogados autônomos',
    highlighted: false,
    features: [
      '1 usuário',
      'Até 100 clientes',
      'IA para análise de casos',
      'Geração de documentos',
      'Transcrição de áudio',
      'Suporte por e-mail',
    ],
  },
  {
    name: 'Profissional',
    description: 'Para escritórios em crescimento',
    highlighted: true,
    features: [
      'Até 5 usuários',
      'Clientes ilimitados',
      'IA avançada + jurisprudência',
      'Modelos premium por área',
      'Kanban e gestão de tarefas',
      'Suporte prioritário',
      'Assinatura digital D4Sign',
    ],
  },
  {
    name: 'Escritório',
    description: 'Para escritórios consolidados',
    highlighted: false,
    features: [
      'Usuários ilimitados',
      'Todas as funcionalidades',
      'API personalizada',
      'Treinamento da equipe',
      'Gerente de conta dedicado',
      'SLA garantido',
      'Personalização da marca',
    ],
  },
]

const TESTIMONIALS = [
  {
    name: 'Dra. Carolina Mendes',
    role: 'Advogada Previdenciária',
    content:
      'O SIMAS transformou meu escritório. Reduzi em 60% o tempo gasto com documentos e nunca mais perdi um prazo. A IA para análise de casos é simplesmente incrível.',
    avatar: 'CM',
  },
  {
    name: 'Dr. Ricardo Almeida',
    role: 'Sócio — Almeida & Associados',
    content:
      'Depois que implementamos o SIMAS, nosso faturamento cresceu 40%. A automação liberou a equipe para focar no que realmente importa: os clientes.',
    avatar: 'RA',
  },
  {
    name: 'Dra. Fernanda Costa',
    role: 'Advogada Trabalhista',
    content:
      'A funcionalidade de IA para análise de jurisprudência economiza horas do meu dia. É como ter um assistente jurídico disponível 24 horas.',
    avatar: 'FC',
  },
]

const STATS = [
  { value: 2500, suffix: '+', label: 'Advogados ativos' },
  { value: 98, suffix: '%', label: 'Satisfação' },
  { value: 60, suffix: '%', label: 'Menos tempo em tarefas' },
  { value: 40, suffix: '%', label: 'Mais produtividade' },
]

const TRUST = [
  { icon: Lock, title: 'LGPD & Criptografia', desc: 'Dados criptografados com isolamento por escritório' },
  { icon: Headphones, title: 'Suporte Especializado', desc: 'Equipe jurídica-tech pronta para ajudar' },
  { icon: Zap, title: 'Atualizações Semanais', desc: 'Novas áreas e funcionalidades toda semana' },
]

/* ─── Stat Card with animated counter ───────────────────── */

function StatCard({ value, suffix, label }: { value: number; suffix: string; label: string }) {
  const { count, ref } = useCountUp(value, 2200)
  return (
    <div ref={ref} className="text-center">
      <p className="font-heading text-3xl font-extrabold text-white md:text-4xl lg:text-5xl">
        {count}
        <span className="text-white/70">{suffix}</span>
      </p>
      <p className="mt-2 text-sm font-medium text-white/60">{label}</p>
    </div>
  )
}

/* ─── Page ─────────────────────────────────────────────── */

export default function LandingPage() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden">
      {/* ═══════════ Navbar ═══════════ */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 sm:px-8">
          <Link href="/" className="flex items-center gap-2.5 group">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary-glow shadow-md shadow-primary/25 transition-shadow group-hover:shadow-lg group-hover:shadow-primary/30">
              <Scale className="h-5 w-5 text-white" />
            </div>
            <span className="font-heading text-xl font-extrabold tracking-tight">
              SIMAS
            </span>
          </Link>

          <div className="hidden items-center gap-8 md:flex">
            {[
              ['#workflow', 'Como funciona'],
              ['#features', 'Funcionalidades'],
              ['#pricing', 'Preços'],
              ['#testimonials', 'Depoimentos'],
            ].map(([href, label]) => (
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
              className="rounded-xl px-4 py-2 text-sm font-semibold text-muted-foreground transition-all hover:text-foreground hover:bg-muted"
            >
              Entrar
            </Link>
            <Link
              href="/login"
              className="group relative rounded-xl bg-gradient-to-r from-primary to-primary-glow px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/25 transition-all hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5"
            >
              Começar grátis
              <ArrowRight className="ml-1.5 inline-block h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>

          {/* Mobile menu button */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="flex h-10 w-10 items-center justify-center rounded-xl border bg-card md:hidden"
          >
            {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="border-t bg-card px-5 py-4 md:hidden">
            <div className="flex flex-col gap-3">
              {[
                ['#workflow', 'Como funciona'],
                ['#features', 'Funcionalidades'],
                ['#pricing', 'Preços'],
                ['#testimonials', 'Depoimentos'],
              ].map(([href, label]) => (
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
                <Link href="/login" className="rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white">Começar grátis</Link>
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
          <div className="absolute right-0 top-20 h-[300px] w-[300px] rounded-full bg-primary-glow/[0.04] blur-[80px]" />
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
              <div className="mx-auto mb-8 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/[0.06] px-4 py-2 text-sm font-semibold text-primary backdrop-blur-sm">
                <Sparkles className="h-4 w-4" />
                Potencializado por Inteligência Artificial
                <ChevronRight className="h-3.5 w-3.5 opacity-60" />
              </div>

              {/* Headline */}
              <h1 className="font-heading text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl md:text-6xl lg:text-7xl">
                A advocacia do futuro,{' '}
                <span className="relative">
                  <span className="bg-gradient-to-r from-primary via-primary-glow to-primary bg-clip-text text-transparent">
                    agora no seu escritório
                  </span>
                  <svg className="absolute -bottom-2 left-0 w-full" viewBox="0 0 300 12" fill="none">
                    <path
                      d="M2 8.5C50 3 100 2 150 5C200 8 250 4 298 6"
                      stroke="hsl(var(--primary))"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeOpacity="0.3"
                    />
                  </svg>
                </span>
              </h1>

              <p className="mx-auto mt-8 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
                Grave consultas, analise casos com IA e gere peças processuais em minutos.
                O SIMAS automatiza o trabalho repetitivo para que você foque nos seus clientes.
              </p>

              {/* CTA buttons */}
              <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                <Link
                  href="/login"
                  className="group relative inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-primary to-primary-glow px-8 py-4 text-base font-bold text-white shadow-xl shadow-primary/25 transition-all hover:shadow-2xl hover:shadow-primary/30 hover:-translate-y-0.5"
                >
                  Começar teste gratuito
                  <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                </Link>
                <a
                  href="#workflow"
                  className="inline-flex items-center gap-2 rounded-2xl border border-border bg-card/80 px-8 py-4 text-base font-semibold text-foreground shadow-sm backdrop-blur-sm transition-all hover:bg-card hover:shadow-md"
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
                  key={area.name}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/80 px-4 py-1.5 text-sm font-medium text-foreground shadow-sm backdrop-blur-sm"
                >
                  <span className={`h-2 w-2 rounded-full bg-gradient-to-r ${area.color}`} />
                  {area.name}
                </span>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ Stats bar ═══════════ */}
      <section className="relative overflow-hidden border-y border-white/10 bg-gradient-to-r from-[hsl(234,65%,18%)] via-[hsl(234,65%,22%)] to-[hsl(250,65%,24%)]">
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '32px 32px',
        }} />
        <div className="relative mx-auto max-w-5xl px-5 py-14 sm:px-8">
          <div className="grid grid-cols-2 gap-8 md:grid-cols-4">
            {STATS.map((s) => (
              <StatCard key={s.label} value={s.value} suffix={s.suffix} label={s.label} />
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ Workflow ═══════════ */}
      <section id="workflow" className="relative py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Reveal>
            <div className="text-center">
              <span className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.15em] text-primary">
                Como funciona
              </span>
              <h2 className="mt-5 font-heading text-3xl font-extrabold text-foreground md:text-4xl lg:text-5xl">
                Da consulta à peça processual{' '}
                <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">em minutos</span>
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                Quatro passos simples. Sem burocracia. Sem horas perdidas.
              </p>
            </div>
          </Reveal>

          <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW_STEPS.map((step, i) => {
              const Icon = step.icon
              return (
                <Reveal key={step.title} delay={i * 100}>
                  <div className="group relative flex flex-col rounded-2xl border border-border/60 bg-card p-7 shadow-card transition-all hover:shadow-card-hover hover:-translate-y-1 hover:border-primary/20">
                    {/* Step number */}
                    <div className="absolute -top-3.5 left-6 flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-glow text-xs font-bold text-white shadow-md shadow-primary/25">
                      {i + 1}
                    </div>

                    <div className="mb-5 mt-2 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/[0.07] transition-colors group-hover:bg-primary/[0.12]">
                      <Icon className="h-7 w-7 text-primary" />
                    </div>

                    <h3 className="font-heading text-lg font-bold text-foreground">{step.title}</h3>
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

      {/* ═══════════ Features ═══════════ */}
      <section id="features" className="relative border-t bg-muted/20 py-24 md:py-32">
        {/* Subtle background glow */}
        <div className="absolute left-0 top-1/2 h-[400px] w-[400px] -translate-y-1/2 rounded-full bg-primary/[0.03] blur-[100px]" />

        <div className="relative mx-auto max-w-7xl px-5 sm:px-8">
          <Reveal>
            <div className="text-center">
              <span className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.15em] text-primary">
                Funcionalidades
              </span>
              <h2 className="mt-5 font-heading text-3xl font-extrabold text-foreground md:text-4xl lg:text-5xl">
                Tudo que seu escritório precisa
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                IA, automação e organização — projetados por quem entende a rotina jurídica.
              </p>
            </div>
          </Reveal>

          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => {
              const Icon = f.icon
              return (
                <Reveal key={f.title} delay={i * 80}>
                  <div className="group relative flex flex-col rounded-2xl border border-border/60 bg-card p-7 shadow-card transition-all hover:shadow-card-hover hover:-translate-y-1 hover:border-primary/20 h-full">
                    <div className={`mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl ${f.accent} transition-transform group-hover:scale-110`}>
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="font-heading text-lg font-bold text-foreground">{f.title}</h3>
                    <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                  </div>
                </Reveal>
              )
            })}
          </div>

          {/* Three pillars */}
          <Reveal delay={200}>
            <div className="mt-16 rounded-2xl border border-primary/10 bg-gradient-to-br from-primary/[0.04] to-transparent p-8 md:p-12">
              <h3 className="text-center font-heading text-xl font-bold text-foreground md:text-2xl">
                Três pilares por área jurídica
              </h3>
              <div className="mt-8 grid gap-6 md:grid-cols-3">
                {[
                  {
                    icon: Zap,
                    emoji: '⚡',
                    title: 'Peças com IA',
                    desc: 'Petição, Contestação, Réplica, Apelação, Agravo, Embargos — geradas e refinadas com inteligência artificial.',
                  },
                  {
                    icon: FileText,
                    emoji: '📄',
                    title: 'Modelos Prontos',
                    desc: 'Procuração, Contrato de Honorários, Substabelecimento, Declarações — templates do escritório sempre à mão.',
                  },
                  {
                    icon: Brain,
                    emoji: '🧠',
                    title: 'Consultoria IA',
                    desc: 'Análise de caso, parecer jurídico, estratégia processual e plano de provas — tudo em linguagem acessível.',
                  },
                ].map((pillar) => (
                  <div key={pillar.title} className="flex flex-col items-center text-center">
                    <span className="mb-3 text-3xl">{pillar.emoji}</span>
                    <h4 className="font-heading text-base font-bold text-foreground">{pillar.title}</h4>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{pillar.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ Pricing ═══════════ */}
      <section id="pricing" className="relative border-t py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Reveal>
            <div className="text-center">
              <span className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.15em] text-primary">
                Preços
              </span>
              <h2 className="mt-5 font-heading text-3xl font-extrabold text-foreground md:text-4xl lg:text-5xl">
                Planos que crescem com você
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
                Comece com teste gratuito. Sem cartão. Sem compromisso.
              </p>
            </div>
          </Reveal>

          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {PLANS.map((plan, i) => (
              <Reveal key={plan.name} delay={i * 100}>
                <div
                  className={`relative flex h-full flex-col rounded-2xl border p-8 transition-all hover:-translate-y-1 ${
                    plan.highlighted
                      ? 'border-primary bg-card shadow-xl shadow-primary/10 ring-1 ring-primary/20'
                      : 'border-border/60 bg-card shadow-card hover:shadow-card-hover'
                  }`}
                >
                  {plan.highlighted && (
                    <span className="absolute -top-3.5 left-1/2 -translate-x-1/2 rounded-full bg-gradient-to-r from-primary to-primary-glow px-4 py-1 text-xs font-bold text-white shadow-md shadow-primary/25">
                      Mais popular
                    </span>
                  )}

                  <h3 className="font-heading text-xl font-bold text-foreground">{plan.name}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>

                  <ul className="mt-8 flex-1 space-y-3.5">
                    {plan.features.map((feat) => (
                      <li key={feat} className="flex items-start gap-2.5 text-sm text-muted-foreground">
                        <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                          plan.highlighted ? 'bg-primary/10' : 'bg-muted'
                        }`}>
                          <Check className={`h-3 w-3 ${plan.highlighted ? 'text-primary' : 'text-muted-foreground'}`} />
                        </div>
                        {feat}
                      </li>
                    ))}
                  </ul>

                  <Link
                    href="/login"
                    className={`mt-8 block rounded-xl px-5 py-3 text-center text-sm font-bold transition-all ${
                      plan.highlighted
                        ? 'bg-gradient-to-r from-primary to-primary-glow text-white shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5'
                        : 'border border-border bg-card text-foreground hover:bg-muted hover:border-primary/20'
                    }`}
                  >
                    Começar teste grátis
                  </Link>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ Testimonials ═══════════ */}
      <section id="testimonials" className="relative border-t bg-muted/20 py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <Reveal>
            <div className="text-center">
              <span className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-bold uppercase tracking-[0.15em] text-primary">
                Depoimentos
              </span>
              <h2 className="mt-5 font-heading text-3xl font-extrabold text-foreground md:text-4xl lg:text-5xl">
                Quem usa, recomenda
              </h2>
            </div>
          </Reveal>

          <div className="mt-16 grid gap-6 md:grid-cols-3">
            {TESTIMONIALS.map((t, i) => (
              <Reveal key={t.name} delay={i * 100}>
                <div className="flex h-full flex-col rounded-2xl border border-border/60 bg-card p-7 shadow-card transition-all hover:shadow-card-hover hover:-translate-y-1">
                  {/* Stars */}
                  <div className="mb-4 flex gap-1">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <Star key={j} className="h-4 w-4 fill-amber-400 text-amber-400" />
                    ))}
                  </div>

                  <p className="flex-1 text-sm leading-relaxed text-muted-foreground italic">
                    &ldquo;{t.content}&rdquo;
                  </p>

                  <div className="mt-6 flex items-center gap-3 border-t border-border/60 pt-5">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-glow text-xs font-bold text-white">
                      {t.avatar}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-foreground">{t.name}</p>
                      <p className="text-xs text-muted-foreground">{t.role}</p>
                    </div>
                  </div>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ═══════════ CTA ═══════════ */}
      <section className="relative overflow-hidden border-t">
        <div className="absolute inset-0 bg-gradient-to-br from-[hsl(234,65%,18%)] via-[hsl(234,65%,22%)] to-[hsl(250,60%,26%)]" />
        <div className="absolute inset-0 opacity-5" style={{
          backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)',
          backgroundSize: '24px 24px',
        }} />
        {/* Glow */}
        <div className="absolute left-1/2 top-0 h-[300px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary-glow/20 blur-[100px]" />

        <div className="relative mx-auto max-w-3xl px-5 py-20 text-center sm:px-8 md:py-28">
          <Reveal>
            <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-semibold text-white/80 backdrop-blur-sm">
              <Gavel className="h-4 w-4" />
              Comece hoje mesmo
            </div>

            <h2 className="font-heading text-3xl font-extrabold text-white md:text-4xl lg:text-5xl">
              Pronto para transformar{' '}
              <span className="bg-gradient-to-r from-white to-white/60 bg-clip-text text-transparent">
                seu escritório?
              </span>
            </h2>

            <p className="mx-auto mt-6 max-w-xl text-lg text-white/60">
              Junte-se a milhares de advogados que já economizam tempo e aumentam a produtividade com o SIMAS.
            </p>

            <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <Link
                href="/login"
                className="group inline-flex items-center gap-2 rounded-2xl bg-white px-8 py-4 text-base font-bold text-[hsl(234,65%,22%)] shadow-xl transition-all hover:shadow-2xl hover:-translate-y-0.5"
              >
                Começar agora — é grátis
                <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ═══════════ Trust badges ═══════════ */}
      <section className="border-t py-14">
        <div className="mx-auto max-w-7xl px-5 sm:px-8">
          <div className="grid gap-8 md:grid-cols-3">
            {TRUST.map((t, i) => {
              const Icon = t.icon
              return (
                <Reveal key={t.title} delay={i * 80}>
                  <div className="flex items-center gap-4">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07]">
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
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-primary-glow">
                <Scale className="h-4 w-4 text-white" />
              </div>
              <span className="font-heading text-sm font-bold">SIMAS</span>
            </div>
            <p className="text-xs text-muted-foreground">
              &copy; {new Date().getFullYear()} SIMAS — Sistema Jurídico. Todos os direitos reservados.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
