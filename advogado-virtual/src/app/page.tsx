import Link from 'next/link'
import {
  Scale,
  Brain,
  FileText,
  Users,
  Clock,
  LayoutDashboard,
  ShieldCheck,
  Sparkles,
  Check,
  Star,
  ArrowRight,
  Lock,
  Headphones,
  Zap,
} from 'lucide-react'

/* ─── Data ─────────────────────────────────────────────── */

const FEATURES = [
  { icon: Brain,           title: 'IA Jurídica Avançada',  description: 'Análise inteligente de casos, jurisprudência e peças processuais com IA treinada para o direito brasileiro.' },
  { icon: FileText,        title: 'Geração de Documentos', description: 'Crie petições, contratos e pareceres em minutos com modelos inteligentes e personalizáveis.' },
  { icon: Users,           title: 'Gestão de Clientes',    description: 'Centralize informações, histórico e comunicação com seus clientes em um só lugar.' },
  { icon: Clock,           title: 'Controle de Prazos',    description: 'Nunca mais perca um prazo. Alertas automáticos e acompanhamento de andamentos processuais.' },
  { icon: LayoutDashboard, title: 'Dashboard Analítico',   description: 'Visualize métricas do escritório, produtividade e faturamento em tempo real.' },
  { icon: ShieldCheck,     title: 'Segurança Total',       description: 'Dados criptografados, backups automáticos e conformidade com LGPD garantidos.' },
]

const PLANS = [
  {
    name: 'Essencial', price: '197', description: 'Para advogados autônomos', highlighted: false,
    features: ['1 usuário', 'Gestão de até 100 clientes', 'IA para análise de casos', 'Geração de documentos básica', 'Controle de prazos', 'Suporte por e-mail'],
  },
  {
    name: 'Profissional', price: '397', description: 'Para escritórios em crescimento', highlighted: true,
    features: ['Até 5 usuários', 'Clientes ilimitados', 'IA avançada + jurisprudência', 'Modelos de documentos premium', 'Dashboard analítico completo', 'Suporte prioritário', 'Integração com tribunais'],
  },
  {
    name: 'Escritório', price: '697', description: 'Para escritórios consolidados', highlighted: false,
    features: ['Usuários ilimitados', 'Todas as funcionalidades', 'API personalizada', 'Treinamento da equipe', 'Gerente de conta dedicado', 'SLA garantido', 'Personalização da marca'],
  },
]

const TESTIMONIALS = [
  { name: 'Dra. Carolina Mendes', role: 'Advogada Previdenciária', content: 'O SIMAS transformou meu escritório. Reduzi em 60% o tempo gasto com documentos e nunca mais perdi um prazo. A IA para análise de casos é simplesmente incrível.' },
  { name: 'Dr. Ricardo Almeida',  role: 'Sócio - Almeida & Associados', content: 'Depois que implementamos o SIMAS, nosso faturamento cresceu 40%. A automação de tarefas repetitivas liberou a equipe para focar no que realmente importa: os clientes.' },
  { name: 'Dra. Fernanda Costa',  role: 'Advogada Trabalhista', content: 'A funcionalidade de IA para análise de jurisprudência economiza horas do meu dia. É como ter um assistente jurídico disponível 24 horas por dia.' },
]

const STATS = [
  { value: '2.500+', label: 'Advogados ativos' },
  { value: '98%',    label: 'Satisfação' },
  { value: '60%',    label: 'Menos tempo em tarefas' },
  { value: '40%',    label: 'Mais produtividade' },
]

const TRUST = [
  { icon: Lock,       title: 'Dados Seguros',           desc: 'Criptografia de ponta e conformidade com LGPD' },
  { icon: Headphones, title: 'Suporte Dedicado',        desc: 'Equipe especializada pronta para ajudar' },
  { icon: Zap,        title: 'Atualizações Constantes', desc: 'Novas funcionalidades toda semana' },
]

/* ─── Page ─────────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ─── Navbar ─── */}
      <nav className="sticky top-0 z-50 border-b bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <Scale className="h-6 w-6 text-primary" />
            <span className="font-heading text-xl font-extrabold tracking-tight text-foreground">SIMAS</span>
          </Link>

          <div className="hidden items-center gap-6 md:flex">
            <a href="#features" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">Funcionalidades</a>
            <a href="#pricing" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">Preços</a>
            <a href="#testimonials" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">Depoimentos</a>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/login"
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Entrar
            </Link>
            <Link
              href="/login"
              className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
            >
              Começar grátis
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 via-transparent to-transparent" />
        <div className="relative mx-auto max-w-4xl px-4 pb-16 pt-20 text-center sm:px-6 sm:pt-28 md:pt-32">
          <div className="mx-auto mb-6 inline-flex items-center gap-2 rounded-full border bg-card px-4 py-1.5 text-sm font-medium text-primary shadow-sm">
            <Sparkles className="h-4 w-4" />
            Potencializado por Inteligência Artificial
          </div>

          <h1 className="font-heading text-4xl font-extrabold leading-tight tracking-tight text-foreground sm:text-5xl md:text-6xl">
            Maximize sua advocacia{' '}
            <span className="bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              de forma simples
            </span>
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground md:text-xl">
            A solução completa com IA que automatiza tarefas, analisa casos e gera documentos para que você foque no que realmente importa: seus clientes.
          </p>

          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow-md transition-colors hover:bg-primary/90"
            >
              Começar teste gratuito
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {/* Stats */}
          <div className="mx-auto mt-16 grid max-w-2xl grid-cols-2 gap-8 md:grid-cols-4">
            {STATS.map((s) => (
              <div key={s.label} className="text-center">
                <p className="font-heading text-2xl font-extrabold text-foreground md:text-3xl">{s.value}</p>
                <p className="mt-1 text-sm text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features ─── */}
      <section id="features" className="border-t bg-muted/30 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <span className="text-sm font-bold uppercase tracking-widest text-primary">Funcionalidades</span>
            <h2 className="mt-3 font-heading text-3xl font-extrabold text-foreground md:text-4xl">
              Tudo que seu escritório precisa
            </h2>
          </div>

          <div className="mt-14 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => {
              const Icon = f.icon
              return (
                <div key={f.title} className="group rounded-2xl border bg-card p-6 shadow-sm transition-shadow hover:shadow-md">
                  <div className="mb-4 inline-flex rounded-xl bg-primary/10 p-3">
                    <Icon className="h-6 w-6 text-primary" />
                  </div>
                  <h3 className="font-heading text-lg font-bold text-foreground">{f.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.description}</p>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── Pricing ─── */}
      <section id="pricing" className="border-t py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <span className="text-sm font-bold uppercase tracking-widest text-primary">Preços</span>
            <h2 className="mt-3 font-heading text-3xl font-extrabold text-foreground md:text-4xl">
              Planos para cada escritório
            </h2>
          </div>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative flex flex-col rounded-2xl border p-6 shadow-sm ${
                  plan.highlighted
                    ? 'border-primary bg-card ring-2 ring-primary/20'
                    : 'bg-card'
                }`}
              >
                {plan.highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-3 py-0.5 text-xs font-bold text-primary-foreground">
                    Mais popular
                  </span>
                )}
                <h3 className="font-heading text-xl font-bold text-foreground">{plan.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{plan.description}</p>

                <ul className="mt-5 flex-1 space-y-3">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-2 text-sm text-muted-foreground">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      {feat}
                    </li>
                  ))}
                </ul>

                <Link
                  href="/login"
                  className={`mt-8 block rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-colors ${
                    plan.highlighted
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'border bg-card text-foreground hover:bg-muted'
                  }`}
                >
                  Começar teste grátis
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Testimonials ─── */}
      <section id="testimonials" className="border-t bg-muted/30 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="text-center">
            <span className="text-sm font-bold uppercase tracking-widest text-primary">Depoimentos</span>
            <h2 className="mt-3 font-heading text-3xl font-extrabold text-foreground md:text-4xl">
              O que nossos clientes dizem
            </h2>
          </div>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {TESTIMONIALS.map((t) => (
              <div key={t.name} className="flex flex-col rounded-2xl border bg-card p-6 shadow-sm">
                <div className="mb-3 flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} className="h-4 w-4 fill-yellow-400 text-yellow-400" />
                  ))}
                </div>
                <p className="flex-1 text-sm leading-relaxed text-muted-foreground">&ldquo;{t.content}&rdquo;</p>
                <div className="mt-4 border-t pt-4">
                  <p className="text-sm font-semibold text-foreground">{t.name}</p>
                  <p className="text-xs text-muted-foreground">{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="bg-primary py-16">
        <div className="mx-auto max-w-3xl px-4 text-center sm:px-6">
          <h2 className="font-heading text-3xl font-extrabold text-primary-foreground md:text-4xl">
            Pronto para transformar seu escritório?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-lg text-primary-foreground/80">
            Junte-se a milhares de advogados que já estão economizando tempo e aumentando a produtividade com o SIMAS.
          </p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-lg bg-white px-6 py-3 text-base font-semibold text-primary shadow-md transition-colors hover:bg-white/90"
            >
              Começar agora — é grátis
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* ─── Footer trust badges ─── */}
      <section className="border-t py-12">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="grid gap-8 md:grid-cols-3">
            {TRUST.map((t) => {
              const Icon = t.icon
              return (
                <div key={t.title} className="flex items-center gap-4 text-center md:text-left">
                  <div className="inline-flex rounded-xl bg-primary/10 p-3 shrink-0">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">{t.title}</p>
                    <p className="text-xs text-muted-foreground">{t.desc}</p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* ─── Footer ─── */}
      <footer className="border-t bg-muted/30 py-6">
        <div className="mx-auto max-w-6xl px-4 text-center sm:px-6">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <Scale className="h-4 w-4 text-primary" />
            <span>&copy; {new Date().getFullYear()} SIMAS. Todos os direitos reservados.</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
