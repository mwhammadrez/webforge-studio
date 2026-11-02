import type { WebForgeApi } from '@shared/ipc'

declare global {
  interface Window {
    webforge: WebForgeApi
  }
}

export {}
