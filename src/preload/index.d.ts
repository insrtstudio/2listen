import type { Api } from './index'

declare global {
  interface Window {
    tl: Api
  }
}

export {}
