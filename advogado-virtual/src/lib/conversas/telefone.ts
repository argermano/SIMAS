// Normalização de telefone para o módulo de conversas (match conversa ↔ cliente
// do SIMAS no /api/conversas/contexto e no Vincular cliente).
//
// A lógica canônica é a da Fase 5 (by-phone do ai-attendant), que vive em
// src/lib/funil/telefone.ts. Re-exportamos a MESMA função — equivalência
// garantida por construção; a rota existente segue intocada.
//
// chaveTelefone(valor): chave de comparação por DÍGITOS, tolerante a máscara BR,
// ao DDI 55 (só removido quando o tamanho indica DDI+DDD+número, 12/13 dígitos —
// 11 dígitos começando com 55 é DDD 55/RS) e ao 9º dígito (via mesmoTelefone).

export { chaveTelefone, mesmoTelefone, apenasDigitos } from '@/lib/funil/telefone'
