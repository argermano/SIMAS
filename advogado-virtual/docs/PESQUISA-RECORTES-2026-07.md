# Pesquisa — serviços pagos de recorte/redundância de publicações (10/07/2026)

Contexto: caso `1068831-05.2020.4.01.3400` (ato de 09/07/2026 da 2ª TR/SJDF que não entrou no
DJEN; Astrea capturou por redundância de fontes). Pergunta do dono: "como o Astrea enxerga
esses casos? tem serviço pago?". Pesquisa executada por 3 agentes com acesso às URLs citadas
em 10/07/2026. Complementa a pesquisa de fontes de ANDAMENTOS de 07/07 (memória da sessão).

## Como o Astrea faz (público)
Infraestrutura própria de robôs, em 2 camadas: (1) publicações por nome/OAB nos diários/DJEN
(processamento ~24h; quantidade de nomes por plano); (2) **intimações eletrônicas** capturadas
nos painéis dos sistemas (PJe/eproc etc.). Integração AASP existe mas é *substituta* (não soma).
Foi a camada 2 (ou pipeline próprio) que pegou o ato fora do DJEN.

## Comparativo (verificado nas docs oficiais em 10/07/2026)

| Provedor | Recorte de diário por nome (API) | Painel de intimação eletrônica | Entrega | Preço |
|---|---|---|---|---|
| **Jusbrasil/Digesto** | ✅ 550+ diários, "Recorte" estruturado (snippet/partes/proc/advs) + termo geral; cobertura lista TJDFT/TJSC/TJPR/TRF1-5/TRT10 e canais "DJEN" | ✅ **Sim** — módulo Intimações lê DJE/PJe/eproc/Projudi/eSAJ com credenciais/certificado do advogado (é o mecanismo que cobre o gap) | Webhook 24/7 (janelas de 3 min); pub média 4h após o diário | "A partir de **R$ 1.000/mês**" + por chamada (sob proposta) |
| **Kurier** | ✅ Kurier Jurídico (diários de justiça e oficiais de todo o Brasil, por nome/OAB/processo, mesmo dia) | Parcial — **Kurier DJE** (Domicílio Judicial Eletrônico) + Kurier Andamento (tribunais, inclusive físicos) | API REST pública documentada (pull + confirmação; sem webhook) | **Sob cotação** |
| **Escavador** | ✅ API V1: monitoramento por termo (nome + 3 variações, termos auxiliares p/ homônimos), 171 diários, callbacks `diario_movimentacao_nova`/`diario_citacao_nova` | ❌ não documentado | Webhook | Créditos pré-pagos; **tabela atrás de login gratuito** no Painel da API (self-service) |
| **AASP** | ✅ 100+ diários + agregação do DJEN (curadoria por variações de nome) | ❌ não faz painel | **API gratuita** para sistema próprio (fluxo formal p/ software se cadastrar); sem doc pública | **R$ 87,90/mês** (associado 100% Digital, intimações incluídas); +R$ 158,50 sociedade |
| **Judit** | ❌ **não tem** produto de publicações/diários (só tracking de processos/andamentos + descoberta por OAB) | ❌ | Webhook (andamentos) | Público: R$ 1k–35k/mês |
| **Codilo** | ❌ (raspagem de sistemas de tribunais: PJe/eSAJ/eproc/Projudi, resolve captcha; não é recorte de diário) | Indireto (consulta processual) | Webhook nativo com confirmação | Sob cotação |

## Leitura honesta para o caso concreto
- Quem **teria pegado** o ato fora do DJEN: **Jusbrasil (Intimações via painel)** e provavelmente
  **Kurier (DJE/Andamento)**. AASP/Escavador leem diários+DJEN — o ato não estava em nenhum diário,
  então provavelmente também não o pegariam.
- A classe de falha é **residual** (falha de indexação do tribunal; TRF1/PJe 2.9.1 instável desde
  jan/2026) e tende a diminuir com a maturação do DJEN (prazos exclusivos nele desde 16/05/2025).

## Recomendação registrada (Fable, 10/07/2026)
1. **Durante o período de comparação**: o Astrea JÁ É a redundância paga — manter e usar a
   comparação como auditoria. Sentinela DataJud×DJEN (em construção) cobre a classe de falha nos
   processos cadastrados, de graça.
2. **Para desligar o Astrea**: cotar **Jusbrasil/Digesto** (paridade total, piso R$ 1.000/mês) e
   **Kurier** (cotação; perguntar: preço por OAB/nome, DJEN+Domicílio no mesmo contrato, webhook).
   Alternativa mínima: **Escavador** (criar conta gratuita e ver a tabela de créditos no painel —
   redundância de diários barata) e/ou **AASP** (R$ 87,90/mês + API gratuita) se o objetivo for
   curadoria de variações de nome, aceitando que painel-PJe fica descoberto.
3. Decisão de assinar algo agora é do dono — economicamente, só faz sentido antes de cancelar o
   Astrea se a comparação revelar gaps recorrentes (até agora: 1 caso residual em ~160 publicações).
