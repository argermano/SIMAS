export const COMANDOS_RAPIDOS = [
  { id: 'organizar_timeline',     label: 'Organizar em linha do tempo',    icone: 'Clock',         disponivel_sem_peca: true  },
  { id: 'listar_documentos',      label: 'Listar documentos necessários',  icone: 'FileCheck',     disponivel_sem_peca: true  },
  { id: 'perguntas_faltantes',    label: 'Perguntas faltantes',            icone: 'HelpCircle',    disponivel_sem_peca: true  },
  { id: 'sugestao_acao',          label: 'Sugestão de ação/recurso',       icone: 'Lightbulb',     disponivel_sem_peca: true  },
  { id: 'riscos_caso',            label: 'Riscos do caso',                 icone: 'AlertTriangle', disponivel_sem_peca: true  },
  { id: 'gerar_peca',             label: 'Gerar peça completa',            icone: 'FileText',      disponivel_sem_peca: false },
  { id: 'adicionar_tutela',       label: 'Adicionar tutela',               icone: 'ShieldAlert',   disponivel_sem_peca: false },
  { id: 'fortalecer_fundamentos', label: 'Fortalecer fundamentos',         icone: 'TrendingUp',    disponivel_sem_peca: false },
  { id: 'refinar_documentos',     label: 'Refinar com documentos',         icone: 'FilePlus',      disponivel_sem_peca: false },
  { id: 'revisar_validar',        label: 'Revisar e validar',              icone: 'CheckCircle',   disponivel_sem_peca: false },
] as const

export type ComandoId = typeof COMANDOS_RAPIDOS[number]['id']
