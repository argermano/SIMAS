import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, BorderStyle, PageBreak,
} from 'docx'
import {
  d4signUploadDocument,
  d4signAddSigners,
  d4signRegisterWebhook,
  d4signSendToSign,
  d4signGetSigningLink,
  d4signListSafes,
} from '@/lib/d4sign/client'
import { taskService } from '@/services/task-service'
import type { D4SignSignerInput } from '@/lib/d4sign/types'

// ─── Reusar parser markdown→docx do exportar-docx ─────────────────────────────
function parseBoldRuns(text: string): TextRun[] {
  const runs: TextRun[] = []
  const parts = text.split(/(\*\*[^*]+\*\*)/)
  for (const part of parts) {
    if (part.startsWith('**') && part.endsWith('**')) {
      runs.push(new TextRun({ text: part.slice(2, -2), bold: true }))
    } else if (part) {
      runs.push(new TextRun({ text: part }))
    }
  }
  return runs.length > 0 ? runs : [new TextRun({ text: '' })]
}

function markdownToDocxParagraphs(markdown: string): Paragraph[] {
  const lines      = markdown.split('\n')
  const paragraphs: Paragraph[] = []
  for (const raw of lines) {
    const t = raw.trim()
    if (t.startsWith('# ')) {
      paragraphs.push(new Paragraph({ text: t.slice(2), heading: HeadingLevel.HEADING_1, alignment: AlignmentType.CENTER, spacing: { before: 400, after: 200 } }))
    } else if (t.startsWith('## ')) {
      paragraphs.push(new Paragraph({ text: t.slice(3), heading: HeadingLevel.HEADING_2, spacing: { before: 320, after: 120 } }))
    } else if (t.startsWith('### ')) {
      paragraphs.push(new Paragraph({ text: t.slice(4), heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 80 } }))
    } else if (t === '---') {
      paragraphs.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' } }, spacing: { before: 80, after: 80 } }))
    } else if (t === '') {
      paragraphs.push(new Paragraph({ spacing: { before: 80, after: 80 } }))
    } else if (t.startsWith('> ')) {
      paragraphs.push(new Paragraph({ children: parseBoldRuns(t.slice(2)), indent: { left: 720 }, spacing: { before: 80, after: 80 } }))
    } else if (t.startsWith('- ') || t.startsWith('* ')) {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: '• ' }), ...parseBoldRuns(t.slice(2))], indent: { left: 360 }, spacing: { before: 60, after: 60 } }))
    } else if (t === '\\pagebreak' || t === '[pagebreak]') {
      paragraphs.push(new Paragraph({ children: [new PageBreak()] }))
    } else {
      paragraphs.push(new Paragraph({ children: parseBoldRuns(t), spacing: { before: 80, after: 80 } }))
    }
  }
  return paragraphs
}

function buildSignatureBlocks(signers: { name: string; cpf_cnpj?: string }[]): Paragraph[] {
  const paragraphs: Paragraph[] = []

  // Espaçamento antes das assinaturas
  paragraphs.push(new Paragraph({ spacing: { before: 600, after: 200 } }))
  paragraphs.push(new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' } },
    spacing: { before: 80, after: 200 },
  }))

  for (const signer of signers) {
    // Espaço para assinatura
    paragraphs.push(new Paragraph({ spacing: { before: 600, after: 0 } }))

    // Linha de assinatura
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: '________________________________________', size: 24 })],
      spacing: { before: 0, after: 40 },
    }))

    // Nome do signatário
    paragraphs.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: signer.name, bold: true, size: 22 })],
      spacing: { before: 0, after: 0 },
    }))

    // CPF se disponível
    if (signer.cpf_cnpj) {
      paragraphs.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: `CPF/CNPJ: ${signer.cpf_cnpj}`, size: 20, color: '666666' })],
        spacing: { before: 0, after: 0 },
      }))
    }
  }

  return paragraphs
}

async function gerarDocxBuffer(
  markdown: string,
  titulo: string,
  signers?: { name: string; cpf_cnpj?: string }[],
): Promise<Buffer> {
  const contentParagraphs = markdownToDocxParagraphs(markdown)
  const signatureBlocks = signers?.length ? buildSignatureBlocks(signers) : []

  const doc = new Document({
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } } },
    sections: [{
      properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
      children: [...contentParagraphs, ...signatureBlocks],
    }],
  })
  const buf = await Packer.toBuffer(doc)
  return Buffer.from(buf)
}

// ─── Validação do body ─────────────────────────────────────────────────────────
const schemaSigner = z.object({
  name:        z.string().min(1),
  email:       z.string().email(),
  cpf_cnpj:    z.string().optional(),
  phone:       z.string().optional(),
  act:         z.enum(['1', '2', '5']).default('1'),
  auth_method: z.enum(['email', 'sms', 'whatsapp', 'pix']).default('email'),
  sign_order:  z.number().int().positive().optional(),
})

const schemaBody = z.object({
  signers:  z.array(schemaSigner).min(1),
  message:  z.string().optional(),
  workflow: z.boolean().optional().default(false),
})

// POST /api/contratos/[id]/assinar
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autenticado' }, { status: 401 })

  const { data: usuario } = await supabase
    .from('users')
    .select('id, tenant_id, role')
    .eq('auth_user_id', user.id)
    .single()

  if (!usuario) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 })
  if (!['admin', 'advogado'].includes(usuario.role)) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }

  // Buscar contrato
  const { data: contrato } = await supabase
    .from('contratos_honorarios')
    .select('id, titulo, conteudo_markdown, status')
    .eq('id', id)
    .eq('tenant_id', usuario.tenant_id)
    .single()

  if (!contrato) return NextResponse.json({ error: 'Contrato não encontrado' }, { status: 404 })
  if (!contrato.conteudo_markdown?.trim()) {
    return NextResponse.json({ error: 'Contrato sem conteúdo para assinar' }, { status: 400 })
  }

  // TODO: restaurar verificação de assinatura ativa após testes
  // const { data: assinaturaExistente } = await supabase
  //   .from('contract_signatures')
  //   .select('id, status')
  //   .eq('contrato_id', id)
  //   .not('status', 'in', '("cancelled")')
  //   .maybeSingle()
  //
  // if (assinaturaExistente && ['waiting_signatures', 'uploaded', 'signers_registered'].includes(assinaturaExistente.status)) {
  //   return NextResponse.json({ error: 'Já existe um processo de assinatura ativo para este contrato' }, { status: 409 })
  // }

  // Validar body
  const body = await req.json()
  const parsed = schemaBody.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Dados inválidos', detalhes: parsed.error.flatten() }, { status: 400 })
  }
  const { signers, message, workflow } = parsed.data

  // Obter safe UUID: variável de ambiente ou auto-descoberta via API
  let safeUuid = process.env.D4SIGN_SAFE_UUID
  if (!safeUuid) {
    try {
      const safes = await d4signListSafes()
      if (safes.length > 0) {
        safeUuid = safes[0].uuid_safe
      }
    } catch { /* silencioso */ }
  }
  if (!safeUuid) {
    return NextResponse.json({ error: 'Nenhum cofre D4Sign encontrado. Configure D4SIGN_SAFE_UUID ou verifique as credenciais.' }, { status: 500 })
  }

  try {
    // 1. Gerar DOCX em buffer (com blocos de assinatura para cada signatário)
    const fileBuffer = await gerarDocxBuffer(
      contrato.conteudo_markdown,
      contrato.titulo,
      signers.map(s => ({ name: s.name, cpf_cnpj: s.cpf_cnpj })),
    )
    const fileName   = `${(contrato.titulo ?? 'contrato').replace(/[^a-zA-Z0-9\s_-]/g, '').trim()}.docx`

    // 2. Upload na D4Sign
    const { uuid: d4signUuid } = await d4signUploadDocument(safeUuid, fileBuffer, fileName)

    // 3. Montar signatários no formato D4Sign
    const d4signSigners: D4SignSignerInput[] = signers.map(s => {
      // Determinar método de notificação
      const method = s.auth_method === 'pix' ? 'email' : s.auth_method

      // Formatar telefone com código do país (+55) para WhatsApp/SMS
      let whatsappNumber: string | undefined
      if ((method === 'whatsapp' || method === 'sms') && s.phone) {
        const digits = s.phone.replace(/\D/g, '')
        whatsappNumber = digits.startsWith('55') ? digits : `55${digits}`
      }

      return {
        email:                 s.email,
        act:                   s.act,
        foreign:               '0',
        certificadoicpbr:      '0',
        assinatura_presencial: '0',
        docauth:               '0',
        docauthandselfie:      '0',
        embed_methodauth:      method,
        whatsapp_number:       whatsappNumber,
        auth_pix:              s.auth_method === 'pix' ? '1' : '0',
      }
    })

    // 4. Cadastrar signatários
    const signerResponses = await d4signAddSigners(d4signUuid, d4signSigners)

    // 5. Registrar webhook (ignorar falha — não é crítico)
    const webhookUrl = process.env.D4SIGN_WEBHOOK_URL
    if (webhookUrl) {
      try { await d4signRegisterWebhook(d4signUuid, webhookUrl) } catch { /* silencioso */ }
    }

    // 6. Enviar para assinatura
    await d4signSendToSign(d4signUuid, {
      message:  message ?? 'Por favor, assine o contrato de honorários advocatícios.',
      workflow: workflow ? '1' : '0',
    })

    // 7. Buscar links de assinatura individuais
    const linksMap: Record<string, string> = {}
    for (const s of signers) {
      try {
        const link = await d4signGetSigningLink(d4signUuid, s.email)
        if (link) linksMap[s.email] = link
      } catch { /* silencioso */ }
    }

    // 8. Salvar no banco
    const { data: signature, error: sigError } = await supabase
      .from('contract_signatures')
      .insert({
        tenant_id:        usuario.tenant_id,
        contrato_id:      id,
        d4sign_uuid:      d4signUuid,
        d4sign_safe_uuid: safeUuid,
        status:           'waiting_signatures',
        sent_at:          new Date().toISOString(),
        created_by:       usuario.id,
      })
      .select('id')
      .single()

    if (sigError || !signature) {
      return NextResponse.json({ error: sigError?.message ?? 'Erro ao salvar assinatura' }, { status: 500 })
    }

    // Salvar signatários com keys e links
    const signersToInsert = signers.map((s, idx) => {
      const d4Key = signerResponses[idx]?.key_signer ?? null
      return {
        signature_id: signature.id,
        name:         s.name,
        email:        s.email,
        cpf_cnpj:     s.cpf_cnpj ?? null,
        phone:        s.phone    ?? null,
        act:          s.act,
        auth_method:  s.auth_method,
        sign_order:   s.sign_order ?? null,
        d4sign_key:   d4Key,
        signing_link: linksMap[s.email] ?? null,
      }
    })

    await supabase.from('contract_signature_signers').insert(signersToInsert)

    // 9. Criar tarefa automática
    try {
      const dueDate = new Date()
      dueDate.setDate(dueDate.getDate() + 7)
      await taskService.createAutomatic({
        description:     `Acompanhar assinatura: ${contrato.titulo}`,
        assigneeId:      usuario.id,
        tenantId:        usuario.tenant_id,
        createdBy:       usuario.id,
        priority:        'media',
        dueDate,
        originReference: `d4sign_signature:${signature.id}`,
        tagNames:        ['ASSINATURA DIGITAL'],
      })
    } catch { /* silencioso — tarefa automática não é crítica */ }

    return NextResponse.json({ signatureId: signature.id, status: 'waiting_signatures' }, { status: 201 })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
