/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** Dev server only: skip Google sign-in for browser tests. Ignored by `vite build`. */
  readonly VITE_AUTH_DISABLED?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "*?raw" {
  const content: string
  export default content
}
