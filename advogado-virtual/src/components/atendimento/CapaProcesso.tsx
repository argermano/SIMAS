'use client'

import { useState } from 'react'
import { validarNumeroCNJ } from '@/lib/jurisprudencia/verificador-citacoes'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import { Scale, Pencil, Loader2 } from 'lucide-react'

export interface DadosProcesso {
  tribunal: string
  numeroProcesso: string
  classe: string
  assuntos: string[]
  orgaoJulgador: string
  dataAjuizamento: string
  grau: string
  movimentos: Array<{ nome: string; data: string }>
}

/**
 * Capa do processo (E2): informa o nº CNJ do caso, valida o dígito verificador
 * no cliente e consulta o DataJud para trazer classe/órgão/assuntos. Sempre
 * sugere + confirma — nunca sobrescreve nada silenciosamente.
 */
export function CapaProcesso({
  atendimentoId,
  numeroInicial,
  dadosIniciais,
}: {
  atendimentoId: string
  numeroInicial?: string | null
  dadosIniciais?: DadosProcesso | null
}) {
  const { success, error: toastError } = useToast()
  const [numero, setNumero] = useState(numeroInicial ?? '')
  const [editando, setEditando] = useState(!numeroInicial)
  const [dados, setDados] = useState<DadosProcesso | null>(dadosIniciais ?? null)
  const [salvando, setSalvando] = useState(false)

  const limpo = numero.replace(/\D/g, '')
  const completo = limpo.length === 20
  const digitoInvalido = completo && !validarNumeroCNJ(limpo)

  async function salvar() {
    setSalvando(true)
    try {
      const res = await fetch(`/api/atendimentos/${atendimentoId}/processo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero: limpo }),
      })
      const data = await res.json()
      if (!res.ok) {
        toastError('Não foi possível salvar', data.error ?? 'Tente novamente')
        return
      }
      setNumero(data.numero)
      setDados(data.dados ?? null)
      setEditando(false)
      success(
        data.encontrado ? 'Processo localizado no DataJud' : 'Número salvo',
        data.encontrado
          ? 'Confira os dados abaixo e ajuste a peça conforme necessário.'
          : data.coberto
            ? 'Não localizado no DataJud (pode não estar indexado ou correr em segredo).'
            : 'Tribunal fora da cobertura do DataJud público.',
      )
    } catch {
      toastError('Erro', 'Falha de rede')
    } finally {
      setSalvando(false)
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Scale className="h-5 w-5 text-muted-foreground" />
          Processo
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {editando ? (
          <div className="space-y-2">
            <label className="text-sm text-muted-foreground">Número único (CNJ) do processo</label>
            <input
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="0000000-00.0000.0.00.0000"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {digitoInvalido && (
              <p className="text-xs text-destructive">O dígito verificador não confere — confira o número.</p>
            )}
            <div className="flex items-center gap-2">
              <Button size="sm" onClick={salvar} disabled={!completo || digitoInvalido || salvando}>
                {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                {salvando ? 'Consultando...' : 'Salvar e consultar'}
              </Button>
              {numeroInicial && (
                <Button size="sm" variant="ghost" onClick={() => { setNumero(numeroInicial); setEditando(false) }} disabled={salvando}>
                  Cancelar
                </Button>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-sm text-foreground">{numero}</span>
            <button onClick={() => setEditando(true)} className="flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <Pencil className="h-3 w-3" /> Alterar
            </button>
          </div>
        )}

        {dados && !editando && (
          <div className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Dados do processo (DataJud)
            </p>
            <p><span className="text-muted-foreground">Tribunal:</span> <span className="font-medium text-foreground">{dados.tribunal}</span></p>
            {dados.classe && <p><span className="text-muted-foreground">Classe:</span> <span className="font-medium text-foreground">{dados.classe}</span></p>}
            {dados.orgaoJulgador && <p><span className="text-muted-foreground">Órgão julgador:</span> <span className="font-medium text-foreground">{dados.orgaoJulgador}</span></p>}
            {dados.assuntos.length > 0 && <p><span className="text-muted-foreground">Assuntos:</span> <span className="font-medium text-foreground">{dados.assuntos.join('; ')}</span></p>}
            {dados.dataAjuizamento && <p><span className="text-muted-foreground">Ajuizamento:</span> <span className="font-medium text-foreground">{dados.dataAjuizamento}</span></p>}
            {dados.movimentos.at(-1) && (
              <p><span className="text-muted-foreground">Último movimento:</span> <span className="font-medium text-foreground">{dados.movimentos.at(-1)!.nome} ({dados.movimentos.at(-1)!.data})</span></p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
