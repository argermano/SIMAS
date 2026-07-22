// Tipagem mínima do pacote `ogv` (não traz @types próprios). Cobre só o que o
// AudioOgvPlayer usa: OGVLoader.base (pasta pública dos assets WASM/worker) e a
// API estilo HTMLMediaElement do OGVPlayer. Restrições em pt-BR.
declare module 'ogv' {
  /** Carregador dos módulos WASM/worker. `base` é a pasta (sem barra final) de
   *  onde eles são buscados — aqui '/ogv', preenchida por scripts/copiar-ogv.mjs. */
  export const OGVLoader: { base: string }

  export interface OGVPlayerOptions {
    debug?: boolean
    debugFilter?: RegExp
    worker?: boolean
    threading?: boolean
    simd?: boolean
  }

  /** Implementa um subconjunto de HTMLMediaElement/HTMLVideoElement. É um elemento
   *  do DOM (instanciável com `new`, anexável via appendChild) — daí estender
   *  HTMLElement, o que já herda addEventListener/style/remove. */
  export class OGVPlayer extends HTMLElement {
    constructor(options?: OGVPlayerOptions)
    src: string
    currentTime: number
    readonly duration: number
    readonly paused: boolean
    readonly ended: boolean
    muted: boolean
    volume: number
    preload: string
    play(): Promise<void> | void
    pause(): void
    load(): void
  }

  export const OGVCompat: { supported(recurso: string): boolean }
  export const OGVVersion: string
}
