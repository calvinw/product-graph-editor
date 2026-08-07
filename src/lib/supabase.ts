import { createClient } from "@supabase/supabase-js"

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim()
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const rememberSignInKey = "prism-lca-remember-sign-in"

export const shouldRememberSignIn = () => localStorage.getItem(rememberSignInKey) !== "false"

export const setRememberSignIn = (remember: boolean) => {
  localStorage.setItem(rememberSignInKey, String(remember))
}

const authStorage = {
  getItem: (key: string) => (shouldRememberSignIn() ? localStorage : sessionStorage).getItem(key),
  setItem: (key: string, value: string) => (shouldRememberSignIn() ? localStorage : sessionStorage).setItem(key, value),
  removeItem: (key: string) => {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
}

export const supabaseConfigurationError = !supabaseUrl || !supabasePublishableKey
  ? "Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env.local."
  : null

export const supabase = supabaseConfigurationError
  ? null
  : createClient(supabaseUrl!, supabasePublishableKey!, {
      auth: { storage: authStorage, persistSession: true },
    })
