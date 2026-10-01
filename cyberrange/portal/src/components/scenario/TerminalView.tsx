'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { Clock, ExternalLink, FileDown, HelpCircle, Info, Wrench } from 'lucide-react'
import { GuideExtraModal, type GuideExtra } from '@/components/scenario/GuideExtraModal'
import { useRouter } from 'next/navigation'
import { Pod, provisioning } from '@/lib/api'
import { Scenario } from '@/hooks/useScenarios'
// NOTE: TerminalView.test.tsx mocks '@/components/ui' with only Button and
// Modal*, so import nothing else from that barrel here.
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui'
import { MilestoneItem } from '@/components/progress/MilestoneItem'
import { VerificationRequestModal } from '@/components/reviews/VerificationRequestModal'
import { useMyReviews } from '@/hooks/useMyReviews'
import { uploadScreenshots } from '@/lib/screenshotUpload'
import { scenarioDisplayTitle, isFlagMilestone } from '@/hooks/useScenarios'
import { FlagSubmission } from '@/components/scenario/FlagSubmission'
import { useToastContext } from '@/context/ToastContext'

import { useSession } from 'next-auth/react'
import { XtermView } from '@/components/terminal/XtermView'
import { destroySession, focusSession, sessionKey } from '@/components/terminal/terminalSessionManager'
import { GuideView } from '@/components/scenario/GuideView'
import { LabCountdown } from '@/components/scenario/LabCountdown'
import { SiemAlertViewer } from '@/components/scenario/SiemAlertViewer'
import { DVWA_PREFIX } from '@/lib/dvwaProxy'
import { podIps } from '@/lib/podIps'
import { copyToClipboard } from '@/lib/copyToClipboard'
import {
  isScenarioComplete,
  passedMilestoneIdsForScenario,
  scenarioProgressKey,
} from '@/lib/scenarioCompletion'

type TermTab = 'kali-cli' | 'meta' | 'dvwa'

// Which terminal tabs each scenario actually uses. Scenario 1 is Kali-only
// (recon + exploit all run from Kali and the scorer reads Kali history), so the
// "Target: meta (lab)" tab is removed there -- it only invited students to run
// commands on the wrong host. Scenarios 3 and 4 still need the Meta shell to
// write artifacts / remediate. Scenario 2 is browser-only (DVWA), handled by
// the DVWA-first layout below.
function tabsForScenario(scenarioId: string): TermTab[] {
  switch (scenarioId) {
    case '01':
      // Kali-only: every task (recon, exploit, and the whoami flag) runs from
      // Kali. The Meta tab isn't needed here.
      return ['kali-cli']
    case '06':
      // Browser-only (DVWA embed); no terminal tabs are rendered for it.
      return ['kali-cli', 'dvwa']
    default:
      return ['kali-cli', 'meta']
  }
}

function defaultTabForScenario(scenarioId: string): TermTab {
  if (scenarioId === '11') return 'meta'
  return 'kali-cli'
}

const DVWA_LOGIN_URL = `${DVWA_PREFIX}/login.php`

// In-portal navigation for the embedded DVWA. DVWA's own left menu doesn't
// render reliably inside the sandboxed iframe on the vulnerable pages, so these
// buttons drive the iframe to each module directly (same session cookie).
const DVWA_NAV: { label: string; path: string }[] = [
  { label: 'Home', path: `${DVWA_PREFIX}/index.php` },
  { label: 'SQL Injection', path: `${DVWA_PREFIX}/vulnerabilities/sqli/` },
  { label: 'XSS (Reflected)', path: `${DVWA_PREFIX}/vulnerabilities/xss_r/` },
  { label: 'DVWA Security', path: `${DVWA_PREFIX}/security.php` },
  { label: 'Login', path: DVWA_LOGIN_URL },
]

interface TerminalViewProps {
  pod: Pod
  scenario: Scenario
  onEnd: () => void
  expired?: boolean
  onRestart?: () => void
  ttlGrace?: boolean
  canRestart?: boolean
  /** When the pod's remaining_seconds was read, for the Score-card countdown. */
  fetchedAtMs?: number
}

const TERM_TAB_BASE =
  'px-4 py-2 text-sm font-medium transition border-b-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40'

const TAB_LABEL: Record<TermTab, string> = {
  'kali-cli': 'Kali Linux (CLI)',
  meta: 'Target: meta (lab)',
  dvwa: 'Target: dvwa (CLI)',
}

export function TerminalView({ pod, scenario, onEnd, expired = false, onRestart, ttlGrace = false, canRestart = false, fetchedAtMs = Date.now() }: TerminalViewProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const token = session?.accessToken as string | undefined
  const { success, warning, error: toastError } = useToastContext()
  const [completed, setCompleted] = useState<Set<number>>(new Set())
  const [loadedProgressKey, setLoadedProgressKey] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<Set<number>>(new Set())
  // Milestones whose single Manual Check was used without passing: the Manual
  // Check button is replaced with an "awaiting instructor review" state (G1).
  const [lockedReview, setLockedReview] = useState<Set<number>>(new Set())
  const [milestonesLoading, setMilestonesLoading] = useState(true)
  const [ending, setEnding] = useState(false)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [activeTab, setActiveTab] = useState<TermTab>(() => defaultTabForScenario(scenario.id))
  const [sidebarTab, setSidebarTab] = useState<'tasks' | 'guide'>('guide')
  const [showAccessHelp, setShowAccessHelp] = useState<'dvwa' | null>(null)
  // SIEM opens as a proper modal dialog (Scenario 3). Closing it returns focus
  // to the terminal so copy/paste keeps working.
  const [showSiemModal, setShowSiemModal] = useState(false)
  // Which DVWA page the embedded iframe shows (Scenario 2). A nonce forces a
  // reload even when the same module is clicked twice.
  const [dvwaNav, setDvwaNav] = useState({ path: DVWA_LOGIN_URL, nonce: 0 })
  const [infoModal, setInfoModal] = useState<'kali' | 'meta' | null>(null)
  // The Kali/meta explainer is useful the first time a student meets a tab,
  // and an interruption every time after — show it once per lab visit.
  const explainedTabs = useRef<Set<'kali' | 'meta'>>(new Set())
  const [showCompletion, setShowCompletion] = useState(false)
  // Tools (terminal icon) and "How scoring works" (Score card) pop-ups.
  const [guideExtra, setGuideExtra] = useState<GuideExtra | null>(null)
  // "Ask an instructor to check" — the student half of the review workflow.
  const myReviews = useMyReviews()
  const [requestFor, setRequestFor] = useState<{ milestoneId: number; mode: 'new' | 'retry' } | null>(null)
  const [labUrls, setLabUrls] = useState<Awaited<ReturnType<typeof provisioning.getLabUrls>> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const currentProgressKey = scenarioProgressKey(pod.pod_id, scenario.id)
  const currentProgressKeyRef = useRef(currentProgressKey)
  currentProgressKeyRef.current = currentProgressKey

  const ips = useMemo(() => {
    try {
      return podIps(pod.pod_id)
    } catch {
      return null
    }
  }, [pod.pod_id])

  const termTabs = useMemo(() => tabsForScenario(scenario.id), [scenario.id])
  // Scenario 2 is browser-only: the main pane embeds DVWA (no terminal), since
  // students don't use a shell here.
  const isBrowserLab = scenario.id === '06'
  const showOpenDvwa = scenario.id === '06'
  const showOpenSiem = scenario.id === '09'

  useEffect(() => {
    if (!showOpenDvwa && !showOpenSiem) return
    let active = true
    provisioning.getLabUrls(pod.pod_id).then((data) => {
      if (active) setLabUrls(data)
    }).catch(() => {
      if (active) setLabUrls(null)
    })
    return () => { active = false }
  }, [pod.pod_id, showOpenDvwa, showOpenSiem])

  // Terminals use xterm.js (XtermView) over the SSH-to-WebSocket microservice.
  // Per BUG-029 (SOLUTION.md Option 2), the project moved away from the Guacamole
  // iframe/guacd-VNC approach entirely for these CLI-only labs - xterm.js sits in the
  // React DOM so keyboard focus is native (no iframe focus traps to recover from).

  // Fetch already completed milestones to restore score state
  useEffect(() => {
    let active = true
    const requestKey = scenarioProgressKey(pod.pod_id, scenario.id)
    setCompleted(new Set())
    setVerifying(new Set())
    setLockedReview(new Set())
    setLoadedProgressKey(null)
    setShowCompletion(false)
    setMilestonesLoading(true)
    provisioning.getMilestones(pod.pod_id).then((res) => {
      if (!active || currentProgressKeyRef.current !== requestKey) return
      if (res && res.milestones) {
        setCompleted(passedMilestoneIdsForScenario(res.milestones, scenario.id))
      }
      setLockedReview(new Set(res?.manual_check_locked ?? []))
      setLoadedProgressKey(requestKey)
      setMilestonesLoading(false)
    }).catch((err) => {
      if (!active || currentProgressKeyRef.current !== requestKey) return
      console.error('Failed to fetch initial milestones:', err)
      toastError('Could not load previous progress - showing current session only.')
      setLoadedProgressKey(requestKey)
      setMilestonesLoading(false)
    })

    return () => {
      active = false
    }
  }, [pod.pod_id, scenario.id, toastError])

  // Auto-detect milestones: poll backend every 3s for new PASS results (BUG-040,
  // shortened from 15s, then 5s, per issue #12 - matches the backend score
  // poller's own 3s cadence (config.SCORE_POLL_INTERVAL_SECONDS) so a result
  // shows up here about as fast as it's physically written. Speed matters for
  // the "did I just hit max points?" moment this feeds into (see the
  // completion-modal effect below, issue #8).
  useEffect(() => {
    if (!pod?.pod_id) return
    let active = true
    const requestKey = scenarioProgressKey(pod.pod_id, scenario.id)
    const interval = setInterval(async () => {
      try {
        const res = await provisioning.getMilestones(pod.pod_id)
        if (!active || currentProgressKeyRef.current !== requestKey || !res?.milestones) return
        setLockedReview(new Set(res.manual_check_locked ?? []))
        const newPassed = passedMilestoneIdsForScenario(res.milestones, scenario.id)

        setCompleted((prev) => {
          const next = new Set(prev)
          let changed = false
          newPassed.forEach((mid) => {
            if (!prev.has(mid)) {
              // New auto-detection - show toast
              const pts = scenario.milestones.find((m) => m.id === mid)?.points ?? 0
              success(`Task auto-detected! +${pts} pts`)
              next.add(mid)
              changed = true
            }
          })
          return changed ? next : prev
        })
      } catch {
        // Silently ignore polling errors - terminal still works
      }
    }, 3000) // Poll every 3 seconds

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [pod.pod_id, scenario.id, scenario.milestones, success])

  const totalPoints = scenario.milestones.reduce((sum, m) => sum + m.points, 0)
  const earnedPoints = scenario.milestones
    .filter((m) => completed.has(m.id))
    .reduce((sum, m) => sum + m.points, 0)
  const doneCount = scenario.milestones.filter((m) => completed.has(m.id)).length
  const nextMilestoneId = milestonesLoading
    ? undefined
    : scenario.milestones.find((m) => !completed.has(m.id))?.id
  const progressPct = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0

  // The current progress-key gate prevents stale or unloaded progress from
  // completing this scenario. Polling returns the previous state when nothing
  // changes (`changed ? next : prev`), so closing the modal does not reopen it.
  // milestonesLoading guards against firing on mount for a fresh pod with
  // totalPoints already computed but completed still empty for one tick.
  useEffect(() => {
    if (milestonesLoading) return
    if (isScenarioComplete({
      scenarioId: scenario.id,
      requiredMilestoneIds: scenario.milestones.map((milestone) => milestone.id),
      completedMilestoneIds: completed,
      currentProgressKey,
      loadedProgressKey,
    })) {
      setShowCompletion(true)
    }
  }, [completed, currentProgressKey, loadedProgressKey, milestonesLoading, scenario.id, scenario.milestones])

  const handleVerify = useCallback(async (milestoneId: number) => {
    if (completed.has(milestoneId)) return
    const requestKey = scenarioProgressKey(pod.pod_id, scenario.id)
    setVerifying((prev) => new Set(prev).add(milestoneId))
    try {
      const result = await provisioning.verifyMilestone(pod.pod_id, scenario.id, milestoneId)
      if (currentProgressKeyRef.current !== requestKey) return
      if (result.status === 'PASS') {
        setCompleted((prev) => new Set(prev).add(milestoneId))
        const pts = scenario.milestones.find((m) => m.id === milestoneId)?.points ?? 0

        let msg = `Task complete! +${pts} pts`
        if (result.detection_score && result.detection_score > 0) {
          msg += ` (Real Alert Bonus${result.detection_data ? `: ${result.detection_data}` : ''})`
        }
        success(msg)
      } else if (result.status === 'FAIL') {
        // The single Manual Check is now used up; the task moves to instructor review.
        setLockedReview((prev) => new Set(prev).add(milestoneId))
        warning(
          result.message ||
            "Manual Check couldn't verify this task. You can now ask an instructor to review it."
        )
      } else if (result.status === 'REVIEW') {
        // Already used (e.g. a stale click): keep it locked to instructor review.
        setLockedReview((prev) => new Set(prev).add(milestoneId))
        warning(
          result.message ||
            'Your Manual Check has already been used. Ask an instructor to review this task.'
        )
      } else {
        toastError('Verification unavailable - your terminal is still working.')
      }
    } catch {
      toastError('Verification unavailable - your terminal is still working.')
    } finally {
      setVerifying((prev) => {
        const next = new Set(prev)
        next.delete(milestoneId)
        return next
      })
    }
  }, [completed, pod.pod_id, scenario.id, scenario.milestones, success, warning, toastError])

  const teardown = useCallback(() => {
    setEnding(true)
    // Tear down the persistent terminal sessions for this pod so WebSocket/SSH
    // connections don't linger after the lab ends.
    destroySession(sessionKey(pod.pod_id, 'kali'))
    destroySession(sessionKey(pod.pod_id, 'meta'))
    destroySession(sessionKey(pod.pod_id, 'dvwa'))
    onEnd()
    router.push('/dashboard')
  }, [onEnd, router, pod.pod_id])

  const copyText = useCallback(async (text: string, label: string) => {
    const ok = await copyToClipboard(text)
    if (ok) success(`Copied ${label}`)
    else warning(`Could not copy ${label}`)
  }, [success, warning])

  const podTypeForTab = (tab: TermTab): 'kali' | 'meta' | 'dvwa' =>
    tab === 'kali-cli' ? 'kali' : tab

  // Return keyboard focus to the on-screen terminal — called when an overlay
  // (SIEM modal, Kali/meta explainer) closes, so the shell stays usable and
  // paste works without an extra click (the SIEM copy/paste bug).
  const refocusTerminal = useCallback(() => {
    focusSession(sessionKey(pod.pod_id, podTypeForTab(activeTab)))
  }, [pod.pod_id, activeTab])

  const closeSiem = useCallback(() => {
    setShowSiemModal(false)
    setTimeout(refocusTerminal, 0)
  }, [refocusTerminal])

  const selectTab = (tab: TermTab) => {
    setActiveTab(tab)
    const explainer = tab === 'kali-cli' ? 'kali' : tab === 'meta' ? 'meta' : null
    if (explainer && !explainedTabs.current.has(explainer)) {
      explainedTabs.current.add(explainer)
      setInfoModal(explainer)
    }
  }

  const activeTabTitle = isBrowserLab
    ? 'DVWA — Damn Vulnerable Web App'
    : activeTab === 'kali-cli'
      ? 'Kali Linux (CLI)'
      : activeTab === 'meta'
        ? 'Target: meta (lab)'
        : 'Target: dvwa (CLI)'
  const activeTargetIp = isBrowserLab
    ? undefined
    : activeTab === 'kali-cli'
      ? ips?.kali
      : activeTab === 'meta'
        ? ips?.meta
        : ips?.dvwa
  const activeTargetLabel =
    activeTab === 'kali-cli' ? 'Kali' : activeTab === 'meta' ? 'Meta' : 'DVWA'

  // Newest request per milestone for this scenario (items are newest-first).
  const latestRequest = (milestoneId: number) =>
    myReviews.items.find((i) => i.tracked.scenarioId === scenario.id && i.tracked.milestoneId === milestoneId)
  const activeRequest = requestFor ? latestRequest(requestFor.milestoneId) : undefined
  const requestMilestone = requestFor ? scenario.milestones.find((m) => m.id === requestFor.milestoneId) : undefined

  const termTabClass = (tab: TermTab) =>
    `${TERM_TAB_BASE} ${activeTab === tab ? 'bg-muted text-text-main border-brand' : 'border-transparent text-text-muted hover:text-text-main hover:bg-muted/60'}`

  // The instructor-review affordance for a milestone (pending / retry / new).
  // Shared by the "Not detected yet?" fallback and the locked state after a
  // failed Manual Check, so the review entry point looks the same in both.
  const renderInstructorReview = (milestoneId: number) => {
    const req = latestRequest(milestoneId)
    const status = req?.case?.status
    if (req && (status === 'PENDING' || !req.case)) {
      return (
        <p className="text-xs text-text-muted">
          Instructor review requested — waiting for a reply.
        </p>
      )
    }
    if (status === 'RETRY') {
      return (
        <button
          type="button"
          onClick={() => setRequestFor({ milestoneId, mode: 'retry' })}
          className="text-xs font-semibold text-brand hover:underline rounded focus-ring"
        >
          Your instructor asked for more detail — send again
        </button>
      )
    }
    return (
      <button
        type="button"
        onClick={() => setRequestFor({ milestoneId, mode: 'new' })}
        className="text-xs font-semibold text-brand hover:underline rounded focus-ring"
      >
        Ask an instructor to check this task
      </button>
    )
  }

  const sideTabClass = (tab: 'tasks' | 'guide') =>
    `flex-1 py-2 text-sm font-medium transition border-b-2 -mb-px rounded-t focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40 ${sidebarTab === tab ? 'text-text-main border-brand' : 'text-text-muted border-transparent hover:text-text-main'}`

  return (
    <div className="flex flex-col lg:flex-row flex-1 w-full h-full min-h-0 relative">
      {ttlGrace && !expired && (
        <div role="status" className="absolute top-0 left-0 right-0 z-20 px-3 py-2 bg-amber-50 border-b border-amber-200 text-sm text-amber-900">
          Time limit reached. This lab will close within about 10 minutes. You can keep working until it stops.
        </div>
      )}
      {expired && (
        <div className="absolute inset-0 z-10 bg-white/95 flex items-center justify-center rounded-xl">
          <div className="text-center max-w-sm" role="status">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-warning">
              <Clock size={28} aria-hidden="true" />
            </div>
            <h3 className="text-2xl font-bold mb-2">Session shutting down</h3>
            <p className="text-text-secondary mb-6">
              This lab session is shutting down. Your progress is saved.
            </p>
            <div className="flex gap-3 justify-center">
              {canRestart && onRestart && (
                <Button variant="primary" onClick={onRestart}>Start new session</Button>
              )}
              <Button variant="secondary" onClick={() => window.location.href = '/dashboard'}>
                Back to dashboard
              </Button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={wrapperRef}
        className="w-full min-h-[40vh] lg:min-h-0 flex-1 min-w-0 mb-4 lg:mb-0 lg:mr-4 relative flex flex-col"
        style={{ visibility: expired ? 'hidden' : 'visible' }}
      >
        {/* Card header: active target title + Open DVWA/SIEM */}
        <div
          data-testid="lab-terminal-card-header"
          className="mb-2 flex flex-wrap items-start justify-between gap-2 bg-secondary border border-border rounded-xl px-3 py-2"
        >
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-text-main leading-tight">
              {activeTabTitle}
            </h2>
            {activeTargetIp && (
              <button
                type="button"
                title={`Copy ${activeTargetLabel} IP`}
                className="mt-0.5 text-xs sm:text-sm text-text-secondary hover:text-brand font-mono rounded focus-ring"
                onClick={() => copyText(activeTargetIp, `${activeTargetLabel} IP`)}
              >
                Target: {activeTargetIp}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* The tools this lab uses, as a pop-up instead of a panel tab. */}
            <button
              type="button"
              onClick={() => setGuideExtra('tools')}
              aria-label="Tools for this lab"
              title="Tools for this lab"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-semibold text-text-main hover:border-brand/40 hover:text-brand transition focus-ring"
            >
              <Wrench size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Tools</span>
            </button>
            {showOpenDvwa && (
              <>
                {/* Scenario 2 embeds DVWA in the pane below; this is a fallback
                    to pop it out into a full browser tab (same portal proxy). */}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => window.open(DVWA_LOGIN_URL, '_blank', 'noopener,noreferrer')}
                >
                  Open in new tab
                  <ExternalLink size={14} aria-hidden="true" />
                </Button>
                <button
                  type="button"
                  onClick={() => setShowAccessHelp(showAccessHelp === 'dvwa' ? null : 'dvwa')}
                  aria-expanded={showAccessHelp === 'dvwa'}
                  aria-label="DVWA help"
                  title="DVWA help"
                  className="p-1.5 rounded-lg text-text-muted hover:text-brand hover:bg-muted transition focus-ring"
                >
                  <HelpCircle size={18} aria-hidden="true" />
                </button>
              </>
            )}
            {showOpenSiem && (
              <button
                type="button"
                onClick={() => setShowSiemModal(true)}
                aria-haspopup="dialog"
                aria-expanded={showSiemModal}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-brand/40 text-brand text-sm font-semibold hover:bg-brand/5 transition focus-ring"
              >
                Open SIEM
                <ExternalLink size={14} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Pod IPs: most tasks use the $TARGET_* variables, so the raw
            addresses are one click away instead of always on screen. */}
        {ips && (
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
            <details className="group">
              <summary className="cursor-pointer select-none font-semibold text-text-muted hover:text-text-main rounded w-fit focus-ring">
                Connection details
              </summary>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                <button type="button" className="hover:text-brand font-mono rounded focus-ring" onClick={() => copyText(ips.subnet, 'subnet')}>
                  {ips.subnet}
                </button>
                <button type="button" className="hover:text-brand font-mono rounded focus-ring" onClick={() => copyText(ips.kali, 'Kali IP')}>
                  Kali {ips.kali}
                </button>
                <button type="button" className="hover:text-brand font-mono rounded focus-ring" onClick={() => copyText(ips.meta, 'Meta IP')}>
                  Meta {ips.meta}
                </button>
                <button type="button" className="hover:text-brand font-mono rounded focus-ring" onClick={() => copyText(ips.dvwa, 'DVWA IP')}>
                  DVWA {ips.dvwa}
                </button>
                <span className="text-text-faint">Click to copy</span>
              </div>
            </details>
            {scenario.id === '11' && (
              <span className="text-brand font-semibold">Remediate on the meta tab</span>
            )}
          </div>
        )}

        {showAccessHelp === 'dvwa' && ips && (
          <div className="mb-2 p-3 text-sm border border-border rounded-xl bg-secondary">
            <div className="flex justify-between gap-2 mb-1">
              <p className="font-semibold text-text-main">Using DVWA</p>
              <button type="button" className="text-text-muted hover:text-text-main text-xs rounded focus-ring" onClick={() => setShowAccessHelp(null)}>Close</button>
            </div>
            <ul className="text-text-secondary space-y-1 list-disc pl-5 mb-2">
              <li>
                <strong className="text-text-main">DVWA is embedded on the left</strong>, connected to your lab
                session. Use <strong className="text-text-main">Open in new tab</strong> if you prefer a full window.
              </li>
              <li>
                Log in with <code className="bg-muted px-1 rounded">admin</code> /{' '}
                <code className="bg-muted px-1 rounded">password</code>, then set Security to <strong>Low</strong>.
              </li>
              <li>Each task is scored automatically as you work in DVWA.</li>
            </ul>
            <div className="flex flex-wrap gap-2 mb-2">
              <Button size="sm" variant="secondary" onClick={() => copyText(DVWA_LOGIN_URL, 'DVWA link')}>
                Copy link
              </Button>
            </div>
            <p className="text-text-muted text-xs">
              Page won&apos;t load? Check it from the Kali tab:{' '}
              <code className="bg-muted px-1 rounded break-all">curl -sI http://{ips.dvwa}/dvwa/</code>
            </p>
          </div>
        )}

        {isBrowserLab ? (
          /* Scenario 2: embed DVWA directly in the lab (same portal proxy that
             scores it), so students never leave the page for the terminal. */
          <div className="flex-1 min-h-0 flex flex-col rounded-xl overflow-hidden border border-border bg-white">
            {/* In-portal nav: DVWA's own left menu doesn't render reliably inside
                the sandboxed iframe, so these buttons move the student between
                modules (and back to Home) directly. */}
            <div className="flex flex-wrap items-center gap-1.5 border-b border-border bg-secondary px-2 py-1.5 shrink-0">
              {DVWA_NAV.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setDvwaNav((prev) => ({ path: item.path, nonce: prev.nonce + 1 }))}
                  className="rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-main hover:border-brand/40 hover:text-brand transition focus-ring"
                >
                  {item.label}
                </button>
              ))}
            </div>
            {/* No iframe sandbox attr on purpose: this is same-origin to the
                portal (/lab/dvwa proxy), so it behaves exactly like the proven
                "open in new tab" flow - session cookie flows and scoring runs at
                the proxy. The proxy already applies its own per-page CSP sandbox
                to the vulnerable modules (XSS isolation), new tab or embedded. */}
            <iframe
              key={dvwaNav.nonce}
              src={dvwaNav.path}
              title="DVWA - Damn Vulnerable Web Application"
              className="w-full flex-1 min-h-0 border-0"
            />
          </div>
        ) : (
          <>
            {/* Connection Tabs — only the tabs this scenario actually uses. */}
            <div className="flex bg-secondary border border-border rounded-t-xl overflow-hidden shrink-0">
              {termTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => selectTab(tab)}
                  aria-pressed={activeTab === tab}
                  className={termTabClass(tab)}
                >
                  {TAB_LABEL[tab]}
                </button>
              ))}
            </div>

            <div className="flex-1 min-h-0 bg-terminal-bg rounded-b-xl overflow-hidden">
              {activeTab === 'kali-cli' && token && termTabs.includes('kali-cli') && (
                <XtermView podId={pod.pod_id} podType="kali" token={token} />
              )}
              {activeTab === 'meta' && token && termTabs.includes('meta') && (
                <XtermView podId={pod.pod_id} podType="meta" token={token} />
              )}
              {activeTab === 'dvwa' && token && termTabs.includes('dvwa') && (
                <XtermView podId={pod.pod_id} podType="dvwa" token={token} />
              )}
              {!token && (
                <div className="w-full h-full flex items-center justify-center text-text-faint">
                  Authenticating...
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Right: Milestone / Guide panel (~40-45% on lg+) */}
      <div
        data-testid="lab-right-panel"
        className="w-full lg:w-[44%] xl:w-[46%] lg:min-w-[24rem] lg:max-w-[56rem] flex-shrink-0 flex flex-col card-surface p-5"
      >
        {/* Score */}
        <div className="mb-4 pb-4 border-b border-border">
          <div className="flex items-end justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-text-muted uppercase tracking-wide font-semibold">Score</span>
                {/* The guide's scoring explainer, as a pop-up where students
                    look when a task doesn't tick. */}
                <button
                  type="button"
                  onClick={() => setGuideExtra('scoring')}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-[11px] font-semibold text-text-muted hover:border-brand/40 hover:text-brand transition focus-ring"
                >
                  <Info size={12} aria-hidden="true" />
                  How scoring works
                </button>
              </div>
              <div className="text-2xl font-bold tabular-nums">
                {milestonesLoading ? (
                  <span className="text-base text-text-muted font-normal">Loading…</span>
                ) : (
                  <>
                    {earnedPoints}
                    <span className="text-text-muted font-normal text-base"> / {totalPoints} pts</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0 pb-1">
              {!expired && pod.expires_at && (
                <span className="inline-flex items-center gap-1 text-xs">
                  <Clock size={13} className="text-text-muted" aria-hidden="true" />
                  <LabCountdown remainingSeconds={pod.remaining_seconds} fetchedAtMs={fetchedAtMs} />
                </span>
              )}
              {!milestonesLoading && (
                <span className="text-xs font-semibold text-text-muted">
                  {doneCount} of {scenario.milestones.length} tasks done
                </span>
              )}
            </div>
          </div>
          <div
            className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden"
            role="progressbar"
            aria-label="Lab progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={milestonesLoading ? 0 : progressPct}
          >
            <div className="h-full rounded-full bg-brand transition-all duration-500" style={{ width: `${milestonesLoading ? 0 : progressPct}%` }} />
          </div>
        </div>

        {/* Sidebar Tabs */}
        <div className="flex items-center border-b border-border mb-4" role="tablist" aria-label="Lab panel">
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'tasks'}
            onClick={() => setSidebarTab('tasks')}
            className={sideTabClass('tasks')}
          >
            Tasks
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={sidebarTab === 'guide'}
            onClick={() => setSidebarTab('guide')}
            className={sideTabClass('guide')}
          >
            Guide
          </button>
          {sidebarTab === 'guide' && (
            <button
              type="button"
              onClick={() => window.print()}
              title="Export the guide as a PDF"
              aria-label="Export guide as PDF"
              className="ml-1 mb-1 inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-text-muted hover:text-brand rounded transition focus-ring"
            >
              <FileDown size={14} aria-hidden="true" />
              PDF
            </button>
          )}
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-4 min-h-0">
          <div className={`flex-1 overflow-y-auto space-y-3 ${sidebarTab === 'tasks' ? 'block' : 'hidden'}`}>
            {scenario.milestones.map((m) => (
                <div key={m.id}>
                  <MilestoneItem
                    id={String(m.id)}
                    name={m.name}
                    description={m.description}
                    points={m.points}
                    completed={completed.has(m.id)}
                    inProgress={m.id === nextMilestoneId}
                  />
                  {!completed.has(m.id) && (
                    isFlagMilestone(scenario.id, m.id) ? (
                      // Capture-the-flag final task: scored by flag submission only.
                      <FlagSubmission
                        scenarioId={scenario.id}
                        milestoneId={m.id}
                        placeholder={scenario.id === '01' ? 'e.g. student' : 'e.g. brave-otter-7421'}
                        onPass={() => setCompleted((prev) => new Set(prev).add(m.id))}
                      />
                    ) : lockedReview.has(m.id) ? (
                      // One-shot Manual Check used without a pass: the task is now
                      // locked to instructor review (G1). No Manual Check button.
                      <div
                        className="mt-1.5 px-2 py-2 rounded-lg border border-amber-200 bg-amber-50 text-xs"
                        role="status"
                      >
                        <p className="font-semibold text-amber-900">
                          Automated check couldn&apos;t verify this task
                        </p>
                        <p className="mt-0.5 text-amber-800">
                          Your Manual Check has been used. An instructor needs to review your
                          work to award the points.
                        </p>
                        <div className="mt-1.5">{renderInstructorReview(m.id)}</div>
                      </div>
                    ) : (
                      <details className="mt-1.5 px-1">
                        <summary className="text-xs text-text-muted cursor-pointer select-none hover:text-text-main rounded w-fit focus-ring">
                          Not detected yet?
                        </summary>
                        <button
                          type="button"
                          onClick={() => handleVerify(m.id)}
                          disabled={verifying.has(m.id) || milestonesLoading}
                          className="mt-1 w-full py-1.5 text-xs font-medium text-text-muted border border-border rounded-lg hover:border-brand/40 hover:text-brand transition disabled:opacity-50 disabled:cursor-not-allowed focus-ring"
                        >
                          {verifying.has(m.id) ? 'Checking…' : 'Manual Check'}
                        </button>
                        <p className="mt-1 text-[11px] text-text-muted">
                          You get one Manual Check. If it can&apos;t verify your work, the task
                          moves to instructor review.
                        </p>
                        <div className="mt-2">{renderInstructorReview(m.id)}</div>
                      </details>
                    )
                  )}
                </div>
            ))}
          </div>
          <div className={`flex-1 overflow-y-auto ${sidebarTab === 'guide' ? 'block' : 'hidden'}`}>
            <GuideView pod={pod} scenario={scenario} />
          </div>
        </div>

        {!expired && (
          <div className="mt-4 pt-4 border-t border-border">
            <Button
              variant="danger-outline"
              size="sm"
              loading={ending}
              onClick={() => setShowEndConfirm(true)}
              className="w-full"
            >
              End Session
            </Button>
          </div>
        )}
      </div>

      <Modal isOpen={infoModal === 'kali'} onClose={() => setInfoModal(null)}>
        <ModalHeader title="Kali Linux (CLI)" />
        <ModalBody>
          <p className="text-text-secondary mb-3">
            <strong className="text-text-main">Kali</strong> is your attacker
            workstation - a Linux VM preloaded with the offensive tools each
            scenario asks you to use (Nmap, Metasploit, sqlmap, etc.).
          </p>
          <p className="text-text-secondary mb-3">
            You run every attack command from this tab, targeting the other
            VMs in your pod by IP (e.g.{' '}
            <code className="text-brand bg-muted px-1 rounded">$TARGET_META</code>).
            It has no vulnerable services of its own - it&apos;s the tool belt,
            not the target.
          </p>
          <p className="text-text-secondary">
            Think of it as the &quot;attacker machine&quot; a real pentest
            would run from - Kali is where you work, meta/DVWA are what
            you&apos;re working on.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            size="sm"
            data-autofocus
            onClick={() => {
              setActiveTab('kali-cli')
              setInfoModal(null)
            }}
          >
            Open Kali terminal
          </Button>
        </ModalFooter>
      </Modal>

      <Modal isOpen={infoModal === 'meta'} onClose={() => setInfoModal(null)}>
        <ModalHeader title="Target: meta (lab)" />
        <ModalBody>
          <p className="text-text-secondary mb-3">
            <strong className="text-text-main">meta</strong> is the vulnerable
            target VM in your pod - a deliberately misconfigured Linux host
            running the services each scenario asks you to attack (Tomcat,
            FTP, SSH, etc.). It has no attack tools of its own.
          </p>
          <p className="text-text-secondary mb-3">
            Attacks are launched from the <strong className="text-text-main">Kali Linux (CLI)</strong>{' '}
            tab against meta&apos;s IP (<code className="text-brand bg-muted px-1 rounded">$TARGET_META</code>).
            This <strong className="text-text-main">Target: meta (lab)</strong> tab
            gives you a direct shell into that VM - useful for checking your
            work (e.g. confirming a service is running, or verifying a shell
            you popped) without going through the exploit each time.
          </p>
          <p className="text-text-secondary">
            Think of it as the &quot;victim machine&quot; a real pentest would
            be scoped against - Kali is your attacker workstation, meta is the
            target.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button
            variant="primary"
            size="sm"
            data-autofocus
            onClick={() => {
              setActiveTab('meta')
              setInfoModal(null)
            }}
          >
            Open meta terminal
          </Button>
        </ModalFooter>
      </Modal>

      <GuideExtraModal scenario={scenario} podId={pod.pod_id} which={guideExtra} onClose={() => setGuideExtra(null)} />

      {/* SIEM dialog (Scenario 3). A real modal: Esc / backdrop / close button all
          dismiss it, it's size-capped and scrolls on small screens, focus is
          trapped while open, and closing returns focus to the terminal so
          copy/paste keeps working. */}
      <Modal isOpen={showSiemModal} onClose={closeSiem} size="xl">
        <ModalHeader title="SIEM — Wazuh alerts" />
        <ModalBody className="space-y-3">
          <p className="text-text-secondary">
            Review the detections your activity generated, then find{' '}
            <strong className="text-text-main">rule 5710</strong> (failed SSH login as a
            non-existent user) — that is your primary true-positive signal. Note its{' '}
            <strong className="text-text-main">time</strong>; you will put that exact time
            into <code className="bg-muted px-1 rounded">incident_timeline.md</code> on the meta tab.
          </p>
          {labUrls?.siem?.ready && labUrls.siem.url && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => window.open(labUrls.siem.url!, '_blank', 'noopener,noreferrer')}
              >
                Open full Wazuh dashboard
                <ExternalLink size={14} aria-hidden="true" />
              </Button>
              <Button size="sm" variant="secondary" onClick={() => copyText(labUrls.siem.url!, 'SIEM URL')}>
                Copy dashboard URL
              </Button>
            </div>
          )}
          <SiemAlertViewer podId={pod.pod_id} />
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="sm" variant="secondary" onClick={() => copyText(labUrls?.siem?.manager || '10.0.40.10', 'Wazuh IP')}>
              Copy Wazuh manager IP
            </Button>
            <span className="text-xs text-text-muted">
              Click a row to copy its timestamp + rule id.
            </span>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={closeSiem} data-autofocus>
            Close
          </Button>
        </ModalFooter>
      </Modal>

      {requestFor && requestMilestone && (
        <VerificationRequestModal
          isOpen
          onClose={() => setRequestFor(null)}
          taskName={requestMilestone.name}
          scenarioLabel={scenarioDisplayTitle(scenario)}
          resubmit={
            requestFor.mode === 'retry' && activeRequest?.case
              ? {
                  feedback: activeRequest.case.feedback,
                  previousReason: activeRequest.case.conflict_reason,
                  previousEvidence: activeRequest.case.report_text,
                }
              : undefined
          }
          onSubmit={async (data) => {
            let reviewId: number
            if (requestFor.mode === 'retry' && activeRequest) {
              reviewId = activeRequest.tracked.reviewId
              await myReviews.resubmit(reviewId, {
                conflictReason: data.conflictReason,
                reportText: data.reportText,
              })
            } else {
              reviewId = await myReviews.submit({
                scenarioId: scenario.id,
                milestoneId: requestFor.milestoneId,
                conflictReason: data.conflictReason,
                reportText: data.reportText,
              })
            }
            // The request is already saved; a screenshot that fails to attach is
            // reported, not thrown (throwing would invite a duplicate re-send).
            const failed = data.images.length ? await uploadScreenshots(reviewId, data.images) : []
            success('Request sent. Your instructor will reply on your dashboard.')
            if (failed.length) warning(`Some screenshots couldn't be attached: ${failed.join(' ')}`)
          }}
        />
      )}

      {/* In-app confirm replaces window.confirm(): consistent styling, and it
          doesn't freeze the page or steal focus from the terminal session. */}
      <Modal isOpen={showEndConfirm} onClose={() => setShowEndConfirm(false)}>
        <ModalHeader title="End this lab session?" />
        <ModalBody>
          <p className="text-text-secondary mb-3">
            Your score is already saved{earnedPoints > 0 ? (
              <> — <strong className="text-text-main">{earnedPoints} / {totalPoints} pts</strong></>
            ) : null}.
          </p>
          <p className="text-text-secondary">
            The lab machines will shut down, and anything you created inside them (files, open shells) will be lost.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={() => setShowEndConfirm(false)} data-autofocus>
            Keep working
          </Button>
          <Button variant="danger" size="sm" loading={ending} onClick={teardown}>
            End session
          </Button>
        </ModalFooter>
      </Modal>

      <Modal isOpen={showCompletion && loadedProgressKey === currentProgressKey} onClose={() => setShowCompletion(false)}>
        <ModalHeader title="Scenario complete!" />
        <ModalBody>
          <p className="text-text-secondary mb-3">
            <strong className="text-text-main">Congratulations</strong> - you
            reached max points on <strong className="text-text-main">{scenario.name}</strong>:{' '}
            <strong className="text-brand">{earnedPoints} / {totalPoints} pts</strong>.
          </p>
          <p className="text-text-secondary">
            Your score is already saved. You can keep exploring this pod, or
            end the session now to free it up.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" size="sm" onClick={() => setShowCompletion(false)}>
            Keep exploring
          </Button>
          <Button variant="primary" size="sm" loading={ending} onClick={teardown}>
            End Session
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}
