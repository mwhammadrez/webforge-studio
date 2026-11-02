import { create } from 'zustand'
import type { AppSettings, PreviewState, Project } from '@shared/types'
import { unwrap, errorMessage } from './lib/api'

export type Route =
  | 'dashboard'
  | 'extract'
  | 'projects'
  | 'workspace'
  | 'qa'
  | 'plugins'
  | 'ai'
  | 'discover'
  | 'settings'

export interface Toast {
  id: string
  type: 'success' | 'error' | 'info' | 'warn'
  title: string
  message?: string
}

interface AppState {
  ready: boolean
  route: Route
  settings: AppSettings | null
  projects: Project[]
  activeProjectId: string | null
  preview: PreviewState | null
  toasts: Toast[]
  sidebarCollapsed: boolean
  init: () => Promise<void>
  navigate: (route: Route, projectId?: string | null) => void
  refreshProjects: () => Promise<void>
  refreshSettings: () => Promise<void>
  setPreview: (preview: PreviewState | null) => void
  setActiveProject: (projectId: string | null) => void
  toast: (type: Toast['type'], title: string, message?: string) => void
  dismissToast: (id: string) => void
  toggleSidebar: () => void
  activeProject: () => Project | null
}

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  route: 'dashboard',
  settings: null,
  projects: [],
  activeProjectId: null,
  preview: null,
  toasts: [],
  sidebarCollapsed: false,
  init: async () => {
    try {
      const [settings, projects] = await Promise.all([
        unwrap(window.webforge.settings.get()),
        unwrap(window.webforge.projects.list())
      ])
      set({ settings, projects, ready: true })
      document.documentElement.dataset.theme = settings.theme === 'system' ? detectTheme() : settings.theme
    } catch (error) {
      set({ ready: true })
      get().toast('error', 'راه‌اندازی برنامه ناموفق بود', errorMessage(error))
    }
  },
  navigate: (route, projectId) => {
    if (projectId !== undefined) set({ activeProjectId: projectId })
    set({ route })
  },
  refreshProjects: async () => {
    try {
      const projects = await unwrap(window.webforge.projects.list())
      set({ projects })
    } catch (error) {
      get().toast('error', 'به‌روزرسانی پروژه‌ها ناموفق بود', errorMessage(error))
    }
  },
  refreshSettings: async () => {
    try {
      const settings = await unwrap(window.webforge.settings.get())
      set({ settings })
      document.documentElement.dataset.theme = settings.theme === 'system' ? detectTheme() : settings.theme
    } catch (error) {
      get().toast('error', 'خواندن تنظیمات ناموفق بود', errorMessage(error))
    }
  },
  setPreview: (preview) => set({ preview }),
  setActiveProject: (activeProjectId) => set({ activeProjectId }),
  toast: (type, title, message) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    set({ toasts: [...get().toasts, { id, type, title, message }] })
    setTimeout(() => get().dismissToast(id), type === 'error' ? 8000 : 4500)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((toast) => toast.id !== id) }),
  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),
  activeProject: () => get().projects.find((project) => project.id === get().activeProjectId) ?? null
}))

function detectTheme(): 'dark' | 'light' {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}
