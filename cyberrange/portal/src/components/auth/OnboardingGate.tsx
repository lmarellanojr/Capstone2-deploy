"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { LoadingSpinner } from "@/components/ui"
import { onboarding } from "@/lib/api"
import { landingPathForRole } from "@/lib/loginRouting"

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { data: session, status } = useSession()
  const pathname = usePathname()
  const router = useRouter()
  const [checking, setChecking] = useState(false)
  const [allowed, setAllowed] = useState(false)

  useEffect(() => {
    if (status !== "authenticated" || pathname === "/orientation" || pathname === "/login") {
      setChecking(false)
      setAllowed(status !== "authenticated" || pathname === "/orientation" || pathname === "/login")
      return
    }

    let active = true
    setChecking(true)
    onboarding.getOrientation().then(({ completed }) => {
      if (!active) return
      if (completed) {
        setAllowed(true)
      } else {
        setAllowed(false)
        router.replace(`/orientation?returnTo=${encodeURIComponent(pathname)}`)
      }
      setChecking(false)
    }).catch(() => {
      if (!active) return
      // Fail closed for protected content when onboarding state cannot be read.
      setAllowed(false)
      setChecking(false)
      router.replace("/orientation")
    })
    return () => { active = false }
  }, [pathname, router, status])

  if (status === "loading" || checking || (status === "authenticated" && !allowed && pathname !== "/orientation")) {
    return <div className="min-h-screen flex items-center justify-center bg-primary"><LoadingSpinner message="Checking orientation..." /></div>
  }

  return <>{children}</>
}
