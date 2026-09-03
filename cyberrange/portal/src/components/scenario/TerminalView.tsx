'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Pod, provisioning } from '@/lib/api'
import { Scenario } from '@/hooks/useScenarios'
import { Button } from '@/components/ui'
import { MilestoneItem } from '@/components/progress/MilestoneItem'
import { useToastContext } from '@/context/ToastContext'

import { useSession } from 'next-auth/react'
import { XtermView } from '@/components/terminal/XtermView'
import { destroySession, sessionKey } from '@/components/terminal/terminalSessionManager'
import { GuideView } from '@/components/scenario/GuideView'
import { SiemAlertViewer } from '@/components/scenario/SiemAlertViewer'
import { DVWA_PREFIX } from '@/lib/dvwaProxy'
import { podIps } from '@/lib/podIps'
import { copyToClipboard } from '@/lib/copyToClipboard'

type TermTab = 'kali-cli' | 'meta' | 'dvwa'

function defaultTabForScenario(scenarioId: string): TermTab {
  if (scenarioId === '11') return 'meta'
  return 'kali-cli'
}

interface TerminalViewProps {
  pod: Pod
  scenario: Scenario
  onEnd: () => void
  expired?: boolean
  onRestart?: () => void
}

export function TerminalView({ pod, scenario, onEnd, expired = false, onRestart }: TerminalViewProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const token = session?.accessToken as string | undefined
  const { success, warning, error: toastError } = useToastContext()
  const [completed, setCompleted] = useState<Set<number>>(new Set())
  const [verifying, setVerifying] = useState<Set<number>>(new Set())
  const [milestonesLoading, setMilestonesLoading] = useState(true)
  const [ending, setEnding] = useState(false)
  const [activeTab, setActiveTab] = useState<TermTab>(() => defaultTabForScenario(scenario.id))
  const [sidebarTab, setSidebarTab] = useState<'tasks' | 'guide'>('guide')
  const [showAccessHelp, setShowAccessHelp] = useState<'dvwa' | 'siem' | null>(null)
  const [labUrls, setLabUrls] = useState<Awaited<ReturnType<typeof provisioning.getLabUrls>> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const ips = useMemo(() => {
    try {
      return podIps(pod.pod_id)
    } catch {
      return null
    }
  }, [pod.pod_id])

  const showDvwaTab = scenario.id === '06'
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
  // iframe/guacd-VNC approach entirely for these CLI-only labs — xterm.js sits in the
  // React DOM so keyboard focus is native (no iframe focus traps to recover from).

  // Fetch already completed milestones to restore score state
  useEffect(() => {
    let active = true
    setMilestonesLoading(true)
    provisioning.getMilestones(pod.pod_id).then((res) => {
      if (!active) return
      if (res && res.milestones) {
        setCompleted(new Set(
          res.milestones.filter((m) => m.status === 'PASS').map((m) => m.milestone_id)
        ))
      }
      setMilestonesLoading(false)
    }).catch((err) => {
      console.error('Failed to fetch initial milestones:', err)
      toastError('Could not load previous progress — showing current session only.')
      setMilestonesLoading(false)
    })

    return () => {
      active = false
    }
  }, [pod.pod_id])

  // Auto-detect milestones: poll backend every 15s for new PASS results (BUG-040)
  useEffect(() => {
    if (!pod?.pod_id) return
    const interval = setInterval(async () => {
      try {
        const res = await provisioning.getMilestones(pod.pod_id)
        if (!res?.milestones) return
        const newPassed = res.milestones
          .filter((m) => m.status === 'PASS')
          .map((m) => m.milestone_id)

        setCompleted((prev) => {
          const next = new Set(prev)
          let changed = false
          newPassed.forEach((mid) => {
            if (!prev.has(mid)) {
              // New auto-detection — show toast
              const pts = scenario.milestones.find((m) => m.id === mid)?.points ?? 0
              success(`Task auto-detected! +${pts} pts`)
              next.add(mid)
              changed = true
            }
          })
          return changed ? next : prev
        })
      } catch {
        // Silently ignore polling errors — terminal still works
      }
    }, 15000) // Poll every 15 seconds

    return () => clearInterval(interval)
  }, [pod.pod_id, scenario.milestones, success])

  const totalPoints = scenario.milestones.reduce((sum, m) => sum + m.points, 0)
  const earnedPoints = scenario.milestones
    .filter((m) => completed.has(m.id))
    .reduce((sum, m) => sum + m.points, 0)

  const handleVerify = useCallback(async (milestoneId: number) => {
    if (completed.has(milestoneId)) return
    setVerifying((prev) => new Set(prev).add(milestoneId))
    try {
      const result = await provisioning.verifyMilestone(pod.pod_id, scenario.id, milestoneId)
      if (result.status === 'PASS') {
        setCompleted((prev) => new Set(prev).add(milestoneId))
        const pts = scenario.milestones.find((m) => m.id === milestoneId)?.points ?? 0
        
        let msg = `Task complete! +${pts} pts`
        if (result.detection_score && result.detection_score > 0) {
          msg += ` (Real Alert Bonus${result.detection_data ? `: ${result.detection_data}` : ''})`
        }
        success(msg)
      } else if (result.status === 'FAIL') {
        warning(result.message || 'Not yet — check your work and try again.')
      } else {
        toastError('Verification unavailable — your terminal is still working.')
      }
    } catch {
      toastError('Verification unavailable — your terminal is still working.')
    } finally {
      setVerifying((prev) => {
        const next = new Set(prev)
        next.delete(milestoneId)
        return next
      })
    }
  }, [completed, pod.pod_id, scenario.id, scenario.milestones, success, warning, toastError])

  const handleEnd = useCallback(async () => {
    if (!confirm('End this lab session? Your progress has been saved.')) return
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

  return (
    <div className="flex flex-1 w-full h-full relative">
      {/* Expiry overlay */}
      {expired && (
        <div className="absolute inset-0 z-10 bg-white/95 flex items-center justify-center rounded-xl">
          <div className="text-center max-w-sm">
            <div className="text-5xl mb-4">⏱</div>
            <h3 className="text-2xl font-bold mb-2">Session Expired</h3>
            <p className="text-text-secondary mb-6">
              Your lab was idle for 30+ minutes and was automatically stopped. Your progress is saved.
            </p>
            <div className="flex gap-3 justify-center">
              {onRestart && (
                <Button variant="primary" onClick={onRestart}>Start New Session</Button>
              )}
              <Button variant="secondary" onClick={() => window.location.href = '/dashboard'}>
                Back to Dashboard
              </Button>
            </div>
          </div>
        </div>
      )}

      <div
        ref={wrapperRef}
        className="flex-1 min-w-0 mr-4 relative flex flex-col"
        style={{ visibility: expired ? 'hidden' : 'visible' }}
      >
        {/* Connection / context strip */}
        {ips && (
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary bg-secondary border border-border rounded-lg px-3 py-2">
            <span className="font-semibold text-text-main">Pod {pod.pod_id}</span>
            <span className="text-border">|</span>
            <button type="button" className="hover:text-brand font-mono" onClick={() => copyText(ips.subnet, 'subnet')}>
              {ips.subnet}
            </button>
            <button type="button" className="hover:text-brand font-mono" onClick={() => copyText(ips.kali, 'Kali IP')}>
              Kali {ips.kali}
            </button>
            <button type="button" className="hover:text-brand font-mono" onClick={() => copyText(ips.meta, 'Meta IP')}>
              Meta {ips.meta}
            </button>
            <button type="button" className="hover:text-brand font-mono" onClick={() => copyText(ips.dvwa, 'DVWA IP')}>
              DVWA {ips.dvwa}
            </button>
            {scenario.id === '11' && (
              <span className="ml-auto text-brand font-semibold">Remediate on: meta tab</span>
            )}
            {showOpenDvwa && (
              <button
                type="button"
                onClick={() => setShowAccessHelp('dvwa')}
                className="ml-auto px-2 py-1 rounded border border-brand/40 text-brand font-semibold hover:bg-brand/5"
              >
                Open DVWA ↗
              </button>
            )}
            {showOpenSiem && (
              <button
                type="button"
                onClick={() => setShowAccessHelp('siem')}
                className="ml-auto px-2 py-1 rounded border border-brand/40 text-brand font-semibold hover:bg-brand/5"
              >
                Open SIEM ↗
              </button>
            )}
          </div>
        )}

        {showAccessHelp === 'dvwa' && ips && (
          <div className="mb-2 p-3 text-sm border border-border rounded-lg bg-secondary">
            <div className="flex justify-between gap-2 mb-1">
              <p className="font-semibold text-text-main">DVWA access</p>
              <button type="button" className="text-text-muted hover:text-text-main text-xs" onClick={() => setShowAccessHelp(null)}>Close</button>
            </div>
            <p className="text-text-secondary mb-2">
              Open DVWA on this portal (<code className="bg-muted px-1 rounded">{DVWA_PREFIX}/</code>
              ) — session required. Do not use the host <code className="bg-muted px-1 rounded">:18301</code> URL.
              On Ampere that host URL is withheld on purpose (LAB_PUBLIC_HOST unset).
            </p>
            <code className="block text-xs bg-muted p-2 rounded break-all mb-2">{DVWA_PREFIX}/</code>
            <div className="flex flex-wrap gap-2 mb-2">
              <Button
                size="sm"
                variant="primary"
                onClick={() => window.open(`${DVWA_PREFIX}/login.php`, '_blank', 'noopener,noreferrer')}
              >
                Open DVWA in new tab
              </Button>
              <Button size="sm" variant="secondary" onClick={() => copyText(`${DVWA_PREFIX}/login.php`, 'DVWA URL')}>
                Copy path
              </Button>
            </div>
            <p className="text-text-secondary text-xs mb-1">Fallback from Kali (pod network only):</p>
            <code className="block text-xs bg-muted p-2 rounded break-all mb-2">
              curl -sI http://{ips.dvwa}/dvwa/
            </code>
            <p className="text-text-secondary text-xs">
              Login <code className="bg-muted px-1 rounded">admin / password</code>, Security{' '}
              <strong>Low</strong>. SQLMap on <strong>Kali</strong> for Milestone 3.
            </p>
          </div>
        )}

        {showAccessHelp === 'siem' && (
          <div className="mb-2 p-3 text-sm border border-border rounded-lg bg-secondary">
            <div className="flex justify-between gap-2 mb-1">
              <p className="font-semibold text-text-main">SIEM access</p>
              <button type="button" className="text-text-muted hover:text-text-main text-xs" onClick={() => setShowAccessHelp(null)}>Close</button>
            </div>
            {labUrls?.siem?.ready && labUrls.siem.url ? (
              <>
                <p className="text-text-secondary mb-2">
                  Open the Wazuh dashboard, then filter to your agents. {labUrls.siem.hint}
                </p>
                <div className="flex flex-wrap gap-2 mb-2">
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => window.open(labUrls.siem.url!, '_blank', 'noopener,noreferrer')}
                  >
                    Open SIEM in new tab
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => copyText(labUrls.siem.url!, 'SIEM URL')}>
                    Copy URL
                  </Button>
                </div>
              </>
            ) : (
              <SiemAlertViewer podId={pod.pod_id} />
            )}
            <Button size="sm" variant="secondary" onClick={() => copyText(labUrls?.siem?.manager || '10.0.40.10', 'Wazuh IP')}>
              Copy Wazuh manager IP
            </Button>
          </div>
        )}

        {/* Connection Tabs */}
        <div className="flex bg-secondary border border-border rounded-t-xl overflow-hidden shrink-0">
          <button
            onClick={() => setActiveTab('kali-cli')}
            className={`px-4 py-2 text-sm font-medium transition ${activeTab === 'kali-cli' ? 'bg-muted text-text-main border-b-2 border-brand' : 'text-text-muted hover:text-text-main hover:bg-muted/60'}`}
          >
            Kali Linux (CLI)
          </button>
          <button
            onClick={() => setActiveTab('meta')}
            className={`px-4 py-2 text-sm font-medium transition ${activeTab === 'meta' ? 'bg-muted text-text-main border-b-2 border-brand' : 'text-text-muted hover:text-text-main hover:bg-muted/60'}`}
          >
            Target: meta (lab)
          </button>
          {showDvwaTab && (
            <button
              onClick={() => setActiveTab('dvwa')}
              className={`px-4 py-2 text-sm font-medium transition ${activeTab === 'dvwa' ? 'bg-muted text-text-main border-b-2 border-brand' : 'text-text-muted hover:text-text-main hover:bg-muted/60'}`}
            >
              Target: dvwa (CLI)
            </button>
          )}
        </div>

        <div className="flex-1 min-h-0 bg-terminal-bg rounded-b-xl overflow-hidden">
          {activeTab === 'kali-cli' && token && (
            <XtermView podId={pod.pod_id} podType="kali" token={token} />
          )}
          {activeTab === 'meta' && token && (
            <XtermView podId={pod.pod_id} podType="meta" token={token} />
          )}
          {activeTab === 'dvwa' && token && (
            <XtermView podId={pod.pod_id} podType="dvwa" token={token} />
          )}
          {!token && (
            <div className="w-full h-full flex items-center justify-center text-text-muted">
              Authenticating...
            </div>
          )}
        </div>
      </div>

      {/* Right: Milestone sidebar */}
      <div className="w-96 flex-shrink-0 flex flex-col card-surface p-5">
        {/* Score */}
        <div className="mb-5 pb-4 border-b border-border">
          <div className="text-xs text-text-secondary uppercase tracking-wide mb-1">Score</div>
          <div className="text-2xl font-bold">
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

        {/* Sidebar Tabs */}
        <div className="flex border-b border-border mb-4">
          <button
            onClick={() => setSidebarTab('tasks')}
            className={`flex-1 py-2 text-sm font-medium transition ${sidebarTab === 'tasks' ? 'text-text-main border-b-2 border-brand' : 'text-text-muted hover:text-text-main'}`}
          >
            Tasks
          </button>
          <button
            onClick={() => setSidebarTab('guide')}
            className={`flex-1 py-2 text-sm font-medium transition ${sidebarTab === 'guide' ? 'text-text-main border-b-2 border-brand' : 'text-text-muted hover:text-text-main'}`}
          >
            Guide
          </button>
        </div>

        {/* Sidebar Content */}
        <div className="flex-1 overflow-y-auto flex flex-col gap-4 min-h-0">
          <div className={`flex-1 overflow-y-auto ${sidebarTab === 'tasks' ? 'block' : 'hidden'}`}>
            {scenario.milestones.map((m) => (
                <div key={m.id}>
                  <MilestoneItem
                    id={String(m.id)}
                    name={m.name}
                    description={m.description}
                    points={m.points}
                    completed={completed.has(m.id)}
                  />
                  {!completed.has(m.id) && (
                    <details className="mt-2">
                      <summary className="text-xs text-text-muted cursor-pointer select-none">
                        Not detected yet?
                      </summary>
                      <button
                        onClick={() => handleVerify(m.id)}
                        disabled={verifying.has(m.id) || milestonesLoading}
                        className="mt-1 w-full py-1 text-xs font-medium text-text-muted border border-border rounded hover:border-brand/40 hover:text-brand transition disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {verifying.has(m.id) ? 'Checking…' : 'Manual Check'}
                      </button>
                    </details>
                  )}
                </div>
            ))}
          </div>
          <div className={`flex-1 overflow-y-auto ${sidebarTab === 'guide' ? 'block' : 'hidden'}`}>
            <GuideView pod={pod} scenario={scenario} />
          </div>
        </div>

        {/* End session */}
        <div className="mt-5 pt-4 border-t border-border">
          <Button
            variant="danger"
            size="sm"
            loading={ending}
            onClick={handleEnd}
            className="w-full"
          >
            End Session
          </Button>
        </div>
      </div>
    </div>
  )
}
