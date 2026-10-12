"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button, LoadingSpinner } from "@/components/ui"
import { onboarding } from "@/lib/api"
import { onboardingRedirectPath } from "@/lib/routeRoles"

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [checking, setChecking] = useState(false)
  const [allowed, setAllowed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const checkedSubject = useRef<string | null>(null)
  const completed = useRef(false)
  const roles = session?.user?.roles
  const subject = session?.user?.email || session?.user?.name || null
  const search = typeof window === "undefined" ? "" : window.location.search

  useEffect(() => {
    if (status !== "authenticated") {
      if (status === "unauthenticated") {
        checkedSubject.current = null
        completed.current = false
      }
      setChecking(false)
      setError(null)
      setAllowed(true)
      return
    }

    const redirect = onboardingRedirectPath(pathname, search, roles, completed.current)
    // Public/error pages and role-less accounts remain under the existing
    // middleware/AuthGate routing and must not call the role-protected API.
    if (!redirect) {
      setChecking(false)
      setError(null)
      setAllowed(true)
      return
    }

    if (checkedSubject.current === subject && completed.current) {
      setChecking(false)
      setError(null)
      setAllowed(true)
      return
    }

    let active = true
    setError(null)
    setChecking(true)
    onboarding.getOrientation().then(({ completed: isComplete }) => {
      if (!active) return
      if (isComplete) {
        completed.current = true
        checkedSubject.current = subject
        setAllowed(true)
      } else {
        setAllowed(false)
        router.replace(redirect)
      }
      setChecking(false)
    }).catch(() => {
      if (!active) return
      // Fail closed for protected content while keeping the current URL and
      // giving the user an explicit retry instead of redirecting.
      setAllowed(false)
      setChecking(false)
      setError("We could not check your orientation status.")
    })
    return () => { active = false }
  }, [pathname, retry, router, roles, search, status, subject])

  if (status === "loading" || checking || (status === "authenticated" && !allowed && !error)) {
    return <div className="min-h-screen flex items-center justify-center bg-primary"><LoadingSpinner message="Checking orientation..." /></div>
  }

  if (status === "authenticated" && error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary p-6">
        <div className="card-surface max-w-md w-full p-8 text-center">
          <h1 className="text-xl font-bold text-text-main mb-2">Orientation check unavailable</h1>
          <p className="text-sm text-text-muted mb-6">{error} Your lab content is still protected.</p>
          <Button variant="primary" onClick={() => setRetry((value) => value + 1)}>Retry</Button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
