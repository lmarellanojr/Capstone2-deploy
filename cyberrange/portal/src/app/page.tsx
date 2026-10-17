import { redirect } from "next/navigation"

// Fallback only — next.config.mjs redirects `/` before this renders. Never
// prerender it: a static `/` ships NEXT_REDIRECT inside a 200 and the client
// router crashes redirecting mid-hydration (React #310, #219).
export const dynamic = "force-dynamic"

export default function Home() {
  redirect("/dashboard")
}
