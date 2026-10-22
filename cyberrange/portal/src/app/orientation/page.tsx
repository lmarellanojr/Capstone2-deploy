"use client"

import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "next-auth/react"
import { Button, LoadingSpinner } from "@/components/ui"
import { onboarding } from "@/lib/api"
import { landingPathForRole, resolveSameOriginPath } from "@/lib/loginRouting"

const studentOrientation = {
  title: "Welcome to your lab orientation",
  intro: "Here is the quick path through your first cybersecurity lab.",
  cta: "Continue to the lab portal",
  steps: [
    ["Choose a lab", "Browse the lab catalog and select a scenario that matches your learning goal."],
    ["Provision your pod", "Start a pod and wait until it reaches ACTIVE status before connecting."],
    ["Follow the guide", "Use the built-in guide and terminal to complete tasks and earn points."],
    ["Finish cleanly", "Destroy your pod when you are done so resources are available for the next lab."],
  ],
}

// Instructors get their own walkthrough of the instructor console, not the
// student lab steps. Admins skip orientation entirely (onboardingRedirectPath).
const instructorOrientation = {
  title: "Welcome to the instructor console",
  intro: "Here is where to find your students' progress and the work that needs your decision.",
  cta: "Continue to the instructor dashboard",
  steps: [
    ["Watch live labs", "Live labs shows who has a lab running right now and how far along each student is."],
    ["Check student progress", "Students lists the roster with each student's progress and pod status. Open a student to see their Wazuh alerts for the current and earlier labs."],
    ["Decide reviews", "When a student asks for review of work that was not credited, it appears in Reviews. Check the evidence and notes, then approve, reject, or ask for a retry. An approval records the task as passed."],
    ["Export results", "Download knowledge-gain data as CSV or JSON from the dashboard (student IDs are always anonymized), or one student's progress as CSV from their page."],
  ],
}

export default function OrientationPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login?callbackUrl=/orientation")
  }, [router, status])

  // Admins skip the orientation. One who opens /orientation directly goes to /admin.
  const isAdmin = landingPathForRole(session?.user?.roles) === "/admin"
  useEffect(() => {
    if (status === "authenticated" && isAdmin) router.replace("/admin")
  }, [router, status, isAdmin])

  const finish = async () => {
    setSaving(true)
    setError(null)
    try {
      await onboarding.completeOrientation()
      const requested = resolveSameOriginPath(searchParams.get("returnTo"), window.location.origin)
      const fallback = landingPathForRole(session?.user?.roles) || "/dashboard"
      router.replace(requested || fallback)
    } catch {
      setError("We could not save your orientation yet. Please try again.")
      setSaving(false)
    }
  }

  const orientation =
    landingPathForRole(session?.user?.roles) === "/instructor" ? instructorOrientation : studentOrientation

  if (status === "loading" || status === "unauthenticated" || isAdmin) {
    return <div className="min-h-screen flex items-center justify-center bg-primary"><LoadingSpinner message="Loading orientation..." /></div>
  }

  return (
    <main className="min-h-screen bg-primary flex items-center justify-center p-6">
      <section className="card-surface max-w-3xl w-full p-8 sm:p-10">
        <p className="text-sm font-semibold text-brand mb-3">MMDC Cyber Range</p>
        <h1 className="text-3xl font-bold text-text-main mb-3">{orientation.title}</h1>
        <p className="text-text-muted mb-8">{orientation.intro}</p>
        <div className="grid gap-4 sm:grid-cols-2 mb-8">
          {orientation.steps.map(([title, description], index) => (
            <div key={title} className="border border-border rounded-lg p-5">
              <p className="text-sm font-bold text-brand mb-2">{index + 1}</p>
              <h2 className="font-semibold text-text-main mb-1">{title}</h2>
              <p className="text-sm text-text-muted">{description}</p>
            </div>
          ))}
        </div>
        {error && <p className="alert-error p-3 text-sm mb-4">{error}</p>}
        <Button variant="primary" size="lg" onClick={finish} loading={saving} disabled={saving} className="w-full sm:w-auto">
          {saving ? "Saving..." : orientation.cta}
        </Button>
      </section>
    </main>
  )
}
