import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'
import { jsPDF } from 'jspdf'
import {
  d4signUploadDocument,
  d4signAddSigners,
  d4signAddPins,
  d4signSendToSign,
  d4signListSafes,
  d4signDelay,
} from '@/lib/d4sign/client'
import { taskService } from '@/services/task-service'
import type { D4SignSignerInput } from '@/lib/d4sign/types'

// ─── Markdown → PDF (jsPDF) ──────────────────────────────────────────────────

interface SignerPosition {
  signerIndex: number
  page: number       // página (1-based)
  xMm: number        // posição X em mm
  yMm: number        // posição Y em mm (na linha de assinatura)
}

function gerarPdfBuffer(
  markdown: string,
  _titulo: string,
  signers?: { name: string; cpf_cnpj?: string }[],
): { buffer: Buffer; totalPages: number; signerPositions: SignerPosition[] } {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  const pageWidth = 210
  const pageHeight = 297
  const margin = 20
  const usableWidth = pageWidth - 2 * margin
  const bottomLimit = pageHeight - margin
  let y = margin

  doc.setFont('times', 'normal')

  function checkPage(needed: number) {
    if (y + needed > bottomLimit) {
      doc.addPage()
      y = margin
    }
  }

  function renderText(text: string, x: number, fontSize: number, maxWidth: number) {
    doc.setFontSize(fontSize)
    const clean = text.replace(/\*\*/g, '')
    const lines = doc.splitTextToSize(clean, maxWidth)
    const lineHeight = fontSize * 0.45
    for (const line of lines) {
      checkPage(lineHeight)
      doc.text(line, x, y)
      y += lineHeight
    }
  }

  function renderHeading(text: string, level: 1 | 2 | 3) {
    const sizes = { 1: 16, 2: 14, 3: 12 }
    const spaceBefore = { 1: 6, 2: 5, 3: 3 }
    const spaceAfter = { 1: 4, 2: 3, 3: 2 }
    const fontSize = sizes[level]

    y += spaceBefore[level]
    checkPage(fontSize * 0.5 + spaceAfter[level])

    doc.setFontSize(fontSize)
    doc.setFont('times', 'bold')
    const clean = text.replace(/\*\*/g, '')
    const lines = doc.splitTextToSize(clean, usableWidth)
    const lineHeight = fontSize * 0.45

    for (const line of lines) {
      checkPage(lineHeight)
      if (level === 1) {
        doc.text(line, pageWidth / 2, y, { align: 'center' })
      } else {
        doc.text(line, margin, y)
      }
      y += lineHeight
    }

    doc.setFont('times', 'normal')
    y += spaceAfter[level]
  }

  // Renderizar conteúdo markdown
  for (const raw of markdown.split('\n')) {
    const t = raw.trim()

    if (t === '') { y += 3; continue }

    if (t === '---') {
      checkPage(6)
      doc.setDrawColor(150)
      doc.line(margin, y, pageWidth - margin, y)
      y += 6
      continue
    }

    if (t === '\\pagebreak' || t === '[pagebreak]') {
      doc.addPage()
      y = margin
      continue
    }

    if (t.startsWith('# ') && !t.startsWith('## ')) { renderHeading(t.slice(2), 1); continue }
    if (t.startsWith('## ') && !t.startsWith('### ')) { renderHeading(t.slice(3), 2); continue }
    if (t.startsWith('### ')) { renderHeading(t.slice(4), 3); continue }

    if (t.startsWith('> ')) {
      doc.setFont('times', 'italic')
      renderText(t.slice(2), margin + 10, 12, usableWidth - 20)
      doc.setFont('times', 'normal')
      y += 1
      continue
    }

    if (t.startsWith('- ') || t.startsWith('* ')) {
      checkPage(5)
      doc.setFontSize(12)
      doc.text('\u2022', margin + 3, y)
      renderText(t.slice(2), margin + 8, 12, usableWidth - 8)
      y += 1
      continue
    }

    doc.setFont('times', 'normal')
    renderText(t, margin, 12, usableWidth)
    y += 1
  }

  // Blocos de assinatura — rastreando posição exata de cada um
  const signerPositions: SignerPosition[] = []
  if (signers?.length) {
    y += 10
    checkPage(20)
    doc.setDrawColor(150)
    doc.line(margin, y, pageWidth - margin, y)
    y += 8

    for (let idx = 0; idx < signers.length; idx++) {
      const signer = signers[idx]
      const blockHeight = signer.cpf_cnpj ? 30 : 25
      checkPage(blockHeight)

      y += 15
      // Registrar posição ACIMA da linha de assinatura e levemente à esquerda
      // D4Sign renderiza o selo a partir do ponto: deslocar 12mm acima e 15mm à esquerda do centro
      signerPositions.push({
        signerIndex: idx,
        page: doc.getNumberOfPages(),
        xMm: (pageWidth / 2) - 15,  // à esquerda do centro
        yMm: y - 12,                // acima da linha ________
      })
      doc.setFontSize(12)
      doc.text('________________________________________', pageWidth / 2, y, { align: 'center' })
      y += 5
      doc.setFont('times', 'bold')
      doc.text(signer.name, pageWidth / 2, y, { align: 'center' })
      doc.setFont('times', 'normal')
      if (signer.cpf_cnpj) {
        y += 4
        doc.setFontSize(10)
        doc.setTextColor(100)
        doc.text(`CPF/CNPJ: ${signer.cpf_cnpj}`, pageWidth / 2, y, { align: 'center' })
        doc.setTextColor(0)
      }
      y += 5
    }
  }

  const totalPages = doc.getNumberOfPages()
  const arrayBuffer = doc.output('arraybuffer')
  return { buffer: Buffer.from(arrayBuffer), totalPages, signerPositions }
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

  // Buscar contrato com dados do cliente
  const { data: contrato } = await supabase
    .from('contratos_honorarios')
    .select('id, titulo, conteudo_markdown, status, area, clientes(nome)')
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
    // 1. Gerar PDF em buffer (com blocos de assinatura para cada signatário)
    const { buffer: fileBuffer, signerPositions } = gerarPdfBuffer(
      contrato.conteudo_markdown,
      contrato.titulo,
      signers.map(s => ({ name: s.name, cpf_cnpj: s.cpf_cnpj })),
    )
    // Nome: [Cliente] + [Área] + [Tipo do documento]
    const clienteNome = (contrato.clientes as { nome?: string } | null)?.nome ?? ''
    const areaNome = contrato.area ? contrato.area.charAt(0).toUpperCase() + contrato.area.slice(1) : ''
    const tipoDoc = 'Contrato'
    const partes = [clienteNome, areaNome, tipoDoc].filter(Boolean)
    const fileLabel = partes.join(' - ').replace(/[^a-zA-Z0-9À-ÿ\s_-]/g, '').trim()
    const fileName = fileLabel ? `${fileLabel}.pdf` : 'contrato.pdf'

    // 2. Upload na D4Sign
    console.log('[assinar] Fazendo upload do documento PDF:', fileName)
    const { uuid: d4signUuid } = await d4signUploadDocument(safeUuid, fileBuffer, fileName, 'application/pdf')
    console.log('[assinar] Upload ok, docUuid:', d4signUuid)

    // Pausa para respeitar rate limit da D4Sign
    await d4signDelay(3000)

    // 3. Montar signatários no formato D4Sign
    const d4signSigners: D4SignSignerInput[] = signers.map(s => {
      const method = s.auth_method === 'pix' ? 'email' : s.auth_method
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

    // 4. Cadastrar signatários (chamada 2/4 à API D4Sign)
    console.log('[assinar] Cadastrando signatários...')
    const signerResponses = await d4signAddSigners(d4signUuid, d4signSigners)
    console.log('[assinar] Signatários cadastrados:', JSON.stringify(signerResponses))

    await d4signDelay(3000)

    // 4.5. Posicionar assinaturas (chamada 3/4 à API D4Sign)
    // Coordenadas calculadas a partir das posições reais no PDF gerado
    // Conversão: D4Sign usa 790x1097 para A4, jsPDF usa 210x297 mm
    try {
      const pins = signerPositions.map((pos, idx) => ({
        email:     signers[idx].email,
        page:      String(pos.page),
        positionX: String(Math.round((pos.xMm / 210) * 790)),
        positionY: String(Math.round((pos.yMm / 297) * 1097)),
      }))
      console.log('[assinar] Posicionando assinaturas:', JSON.stringify(pins))
      await d4signAddPins(d4signUuid, pins)
      await d4signDelay(3000)
    } catch (err) {
      console.warn('[assinar] Falha ao posicionar assinaturas (não crítico):', err)
    }

    // 5. Enviar para assinatura (chamada 4/4 à API D4Sign)
    // NOTA: D4Sign tem limite de 10 req/hora. Fluxo otimizado para 4 chamadas.
    console.log('[assinar] Enviando para assinatura, docUuid:', d4signUuid)
    const sendResult = await d4signSendToSign(d4signUuid, {
      message:  message ?? 'Por favor, assine o contrato de honorários advocatícios.',
      workflow: workflow ? '1' : '0',
    })
    console.log('[assinar] Resultado sendToSign:', JSON.stringify(sendResult))

    // Links de assinatura não buscados para economizar quota (D4Sign envia por email/whatsapp)
    const linksMap: Record<string, string> = {}

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
