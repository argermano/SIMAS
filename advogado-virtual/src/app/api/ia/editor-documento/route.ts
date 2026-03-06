import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { streamCompletion } from '@/lib/anthropic/client'

type Acao = 'reescrever' | 'gerar_topico' | 'comando_livre'

const SYSTEM_EDITOR = `Você é um especialista jurídico brasileiro especializado em redação de documentos jurídicos formais.
Sua tarefa é auxiliar na criação e revisão de documentos jurídicos, mantendo o padrão formal, técnico e preciso exigido pela advocacia brasileira.

REGRAS:
- Mantenha linguagem jurídica formal e técnica
- Use fundamentação legal quando aplicável (artigos de lei, súmulas, jurisprudência)
- Seja direto e objetivo, sem prolixidade desnecessária
- Mantenha coerência com o restante do documento
- Responda APENAS com o conteúdo Markdown da seção solicitada, sem explicações adicionais
- Use # para título principal, ## para seções, ### para subseções`

// POST /api/ia/editor-documento — gerar ou reescrever seção de documento com streaming
export async function POST(req: NextRequest) {
  try {
    const { acao, conteudo, descricao, contexto_documento, instrucao, documento_completo } = await req.json() as {
      acao: Acao
      conteudo?: string
      descricao?: string
      contexto_documento?: string
      instrucao?: string
      documento_completo?: string
    }

    if (!acao) {
      return NextResponse.json({ error: 'acao é obrigatória' }, { status: 400 })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

    let prompt: string

    if (acao === 'reescrever') {
      if (!conteudo) return NextResponse.json({ error: 'conteudo é obrigatório para reescrever' }, { status: 400 })
      prompt = `Reescreva a seguinte seção do documento jurídico, mantendo o mesmo propósito mas melhorando a clareza, precisão e fundamentação jurídica.

CONTEXTO DO DOCUMENTO:
${contexto_documento ?? 'Documento jurídico geral'}

SEÇÃO A REESCREVER:
${conteudo}

Retorne APENAS o conteúdo reescrito da seção em Markdown, sem explicações.`
    } else if (acao === 'comando_livre') {
      if (!instrucao) return NextResponse.json({ error: 'instrucao é obrigatória para comando_livre' }, { status: 400 })
      prompt = `Você recebeu uma instrução do advogado para modificar ou complementar o documento jurídico abaixo.

DOCUMENTO COMPLETO:
${documento_completo ?? contexto_documento ?? '(documento vazio)'}

INSTRUÇÃO DO ADVOGADO:
${instrucao}

REGRAS IMPORTANTES:
- Retorne SEMPRE o documento COMPLETO com a modificação aplicada, não apenas a parte alterada.
- Mantenha TODO o conteúdo original que não foi afetado pela instrução.
- Aplique SOMENTE as alterações solicitadas na instrução.
- Não adicione explicações, comentários ou notas — retorne apenas o Markdown do documento modificado.
- Se a instrução pedir para adicionar conteúdo novo, inclua-o na posição mais adequada dentro do documento.
- Se a instrução pedir mudanças de formatação (espaçamento, numeração, negrito, etc.), aplique em todo o documento conforme solicitado.`
    } else {
      // gerar_topico
      if (!descricao) return NextResponse.json({ error: 'descricao é obrigatória para gerar_topico' }, { status: 400 })
      prompt = `Gere o conteúdo de uma nova seção para o documento jurídico com base na descrição fornecida.

CONTEXTO DO DOCUMENTO:
${contexto_documento ?? 'Documento jurídico geral'}

DESCRIÇÃO DA NOVA SEÇÃO:
${descricao}

Gere o conteúdo completo da seção em Markdown. Inclua um heading (##) como título da seção seguido do conteúdo.
Retorne APENAS o conteúdo Markdown da seção, sem explicações adicionais.`
    }

    const { stream } = await streamCompletion({ system: SYSTEM_EDITOR, prompt })

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Erro desconhecido'
    console.error('[editor-documento]', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
