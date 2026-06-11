// Fonte ÚNICA dos tipos de documento efêmero que aceitam preenchimento de modelo .docx.
// Usada pela rota /api/documentos/exportar-modelo E pela UI (ModeloProntoClient) — assim
// um novo tipo é habilitado em um só lugar (sem listas desincronizadas).

// Mapeia o tipo de geração (gerar-documento) → tipo em modelos_documento
export const TIPO_MODELO_DOCX: Record<string, string> = {
  procuracao: 'procuracao',
  declaracao_hipossuficiencia: 'declaracao',
  substabelecimento: 'substabelecimento',
}

// Nome amigável para mensagens/arquivo
export const NOME_AMIGAVEL_DOC: Record<string, string> = {
  procuracao: 'procuração',
  declaracao_hipossuficiencia: 'declaração',
  substabelecimento: 'substabelecimento',
}

// Lista dos tipos suportados (para o front decidir se mostra o botão "Meu modelo (.docx)")
export const TIPOS_COM_MODELO_DOCX = Object.keys(TIPO_MODELO_DOCX)
