import { describe, it, expect } from 'vitest'
import { montarQRaizApp, APP_RAIZ_KEY, APP_RAIZ_VALOR } from './api'

// Só lógica pura (sem rede): o `q` de busca da raiz PRÓPRIA do app.
describe('montarQRaizApp — q de busca da raiz do app', () => {
  it('filtra pelo appProperties marcador + mimeType de pasta + fora da lixeira', () => {
    expect(montarQRaizApp()).toBe(
      "appProperties has { key='simasRaiz' and value='v1' }" +
        " and mimeType='application/vnd.google-apps.folder' and trashed=false",
    )
  })

  it('o marcador da raiz é simasRaiz=v1 (estável — muda invalidaria as raízes já criadas)', () => {
    expect(APP_RAIZ_KEY).toBe('simasRaiz')
    expect(APP_RAIZ_VALOR).toBe('v1')
  })
})
