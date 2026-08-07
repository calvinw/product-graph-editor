import { useEffect, useState, type ReactNode } from "react"
import type { User } from "@supabase/supabase-js"
import { Share2 } from "lucide-react"
import { setRememberSignIn, shouldRememberSignIn, supabase, supabaseConfigurationError } from "@/lib/supabase"

type AuthGateProps = {
  children: (auth: { user: User; signOut: () => Promise<void> }) => ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [error, setError] = useState<string | null>(supabaseConfigurationError)
  const [remember, setRemember] = useState(shouldRememberSignIn)

  useEffect(() => {
    if (!supabase) return

    let active = true
    supabase.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active) return
      if (sessionError) setError(sessionError.message)
      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  const signInWithGoogle = async () => {
    if (!supabase) return
    setError(null)
    setRememberSignIn(remember)
    const redirectTo = `${window.location.origin}${window.location.pathname}`
    const { error: signInError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    })
    if (signInError) setError(signInError.message)
  }

  const signOut = async () => {
    if (!supabase) return
    setError(null)
    const { error: signOutError } = await supabase.auth.signOut()
    if (signOutError) setError(signOutError.message)
  }

  if (loading) return <AuthScreen><div className="auth-spinner" aria-label="Loading session" /></AuthScreen>

  if (!user) return (
    <AuthScreen>
      <div className="auth-card">
        <div className="auth-brand-mark"><Share2 size={22} /></div>
        <div className="auth-copy">
          <h1>Prism LCA</h1>
          <p>Sign in to access the product graph editor.</p>
        </div>
        {!supabaseConfigurationError ? (
          <>
            <label className="remember-sign-in">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />
              <span><strong>Keep me signed in</strong><small>Stay signed in after closing this browser.</small></span>
            </label>
            <button className="google-sign-in" type="button" onClick={signInWithGoogle}>
              <GoogleMark />
              <span>Sign in with Google</span>
            </button>
          </>
        ) : null}
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
      </div>
    </AuthScreen>
  )

  return children({ user, signOut })
}

function AuthScreen({ children }: { children: ReactNode }) {
  return <main className="auth-screen">{children}</main>
}

function GoogleMark() {
  return <svg aria-hidden="true" width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.08 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.77 24c0-1.6.27-3.14.76-4.59l-7.98-6.19A24 24 0 0 0 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-3.58-13.46-8.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
}
