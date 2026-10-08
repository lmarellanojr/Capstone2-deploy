'use client'

import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { AlertTriangle, Clock, ExternalLink, HelpCircle, Wrench } from 'lucide-react'
import { GuideExtraModal, type GuideExtra } from '@/components/scenario/GuideExtraModal'
import { useRouter } from 'next/navigation'
import { Pod, provisioning } from '@/lib/api'
import { Scenario, getLabSurface } from '@/hooks/useScenarios'
import { Button, Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui'
import { useToastContext } from '@/context/ToastContext'
import { useSession } from 'next-auth/react'
import { XtermView } from '@/components/terminal/XtermView'
import { destroySession, focusSession, sessionKey } from '@/components/terminal/terminalSessionManager'
import { SiemAlertViewer } from '@/components/scenario/SiemAlertViewer'
import { TerminalSideCue } from '@/components/scenario/TerminalSideCue'
import { DVWA_PREFIX } from '@/lib/dvwaProxy'
import { podIps } from '@/lib/podIps'
import { copyToClipboard } from '@/lib/copyToClipboard'

type TermTab = 'kali-cli' | 'meta' | 'dvwa'

function tabsForScenario(scenarioId: string): TermTab[] {
  switch (scenarioId) {
    case '01':
      return ['kali-cli']
    case '06':
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

const DVWA_NAV: { label: string; path: string }[] = [
  { label: 'Home', path: `${DVWA_PREFIX}/index.php` },
  { label: 'SQL Injection', path: `${DVWA_PREFIX}/vulnerabilities/sqli/` },
  { label: 'XSS (Reflected)', path: `${DVWA_PREFIX}/vulnerabilities/xss_r/` },
  { label: 'DVWA Security', path: `${DVWA_PREFIX}/security.php` },
  { label: 'Login', path: DVWA_LOGIN_URL },
]

export interface TerminalViewProps {
  pod: Pod
  scenario: Scenario
  onEnd?: () => void
  expired?: boolean
  onRestart?: () => void
  ttlGrace?: boolean
  canRestart?: boolean
  fetchedAtMs?: number
  currentTaskId?: number
  currentTaskCue?: string
  currentTaskCueVariant?: 'info' | 'warning'
  surface?: 'terminal' | 'dvwa' | 'siem'
  externalGuideExtra?: GuideExtra | null
  onCloseGuideExtra?: () => void
  onOpenTools?: () => void
}

const TERM_TAB_BASE =
  'px-4 py-2 text-sm font-medium transition border-b-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand/40'

const TAB_LABEL: Record<TermTab, string> = {
  'kali-cli': 'Kali Linux (CLI)',
  meta: 'Target: meta (lab)',
  dvwa: 'Target: dvwa (CLI)',
}

export function TerminalView({
  pod,
  scenario,
  onEnd,
  expired = false,
  onRestart,
  ttlGrace = false,
  canRestart = false,
  currentTaskId,
  currentTaskCue,
  currentTaskCueVariant,
  surface = getLabSurface(scenario),
  externalGuideExtra,
  onCloseGuideExtra,
  onOpenTools,
}: TerminalViewProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const token = session?.accessToken as string | undefined
  const { success, warning } = useToastContext()
  const [activeTab, setActiveTab] = useState<TermTab>(() => defaultTabForScenario(scenario.id))
  const [showAccessHelp, setShowAccessHelp] = useState<'dvwa' | null>(null)
  const [showSiemModal, setShowSiemModal] = useState(false)
  const [dvwaNav, setDvwaNav] = useState({ path: DVWA_LOGIN_URL, nonce: 0 })
  const [infoModal, setInfoModal] = useState<'kali' | 'meta' | null>(null)
  const explainedTabs = useRef<Set<'kali' | 'meta'>>(new Set())
  const [localGuideExtra, setLocalGuideExtra] = useState<GuideExtra | null>(null)
  const [labUrls, setLabUrls] = useState<Awaited<ReturnType<typeof provisioning.getLabUrls>> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  const activeGuideExtra = externalGuideExtra ?? localGuideExtra
  const handleCloseGuideExtra = () => {
    setLocalGuideExtra(null)
    onCloseGuideExtra?.()
  }

  const ips = useMemo(() => {
    try {
      return podIps(pod.pod_id)
    } catch {
      return null
    }
  }, [pod.pod_id])

  const termTabs = useMemo<TermTab[]>(() => surface === 'siem' ? ['kali-cli', 'meta'] : tabsForScenario(scenario.id), [scenario.id, surface])
  const isBrowserLab = surface === 'dvwa'
  const showOpenDvwa = surface === 'dvwa'
  const showOpenSiem = surface === 'siem'
  // Scenario 4 (Vulnerability Hardening): every scored step runs on meta, and
  // the common mistake is editing on Kali — so meta is marked as the work tab.
  const isMetaWorkLab = scenario.id === '11'

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

  const copyText = useCallback(async (text: string, label: string) => {
    const ok = await copyToClipboard(text)
    if (ok) success(`Copied ${label}`)
    else warning(`Could not copy ${label}`)
  }, [success, warning])

  const podTypeForTab = (tab: TermTab): 'kali' | 'meta' | 'dvwa' =>
    tab === 'kali-cli' ? 'kali' : tab

  const refocusTerminal = useCallback(() => {
    focusSession(sessionKey(pod.pod_id, podTypeForTab(activeTab)))
  }, [pod.pod_id, activeTab])

  const closeSiem = useCallback(() => {
    setShowSiemModal(false)
    setTimeout(refocusTerminal, 0)
  }, [refocusTerminal])

  const selectTab = (tab: TermTab) => {
    setActiveTab(tab)
    // SIEM explains the hosts beside the terminal; the hardening lab's status
    // line says Kali is unscored, so skip the attacker-framed explainers.
    if (showOpenSiem || isMetaWorkLab) return
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
  // The Kali box is the student's own attack host, not a target — reserve
  // "Target:" for Meta/DVWA so the orientation ("Kali (you)") stays consistent.
  const activeIpPrefix = activeTab === 'kali-cli' ? 'Host' : 'Target'

  const termTabClass = (tab: TermTab) =>
    `${TERM_TAB_BASE} ${activeTab === tab ? 'bg-muted text-text-main border-brand' : 'border-transparent text-text-muted hover:text-text-main hover:bg-muted/60'}`

  return (
    <div
      data-testid="lab-terminal-container"
      className="flex flex-col flex-1 w-full h-full min-w-0 min-h-0 relative"
    >
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
        className="w-full min-h-[40vh] lg:min-h-0 flex-1 min-w-0 relative flex flex-col"
        style={{ visibility: expired ? 'hidden' : 'visible' }}
      >
        {/* Card header: active target title + Open DVWA/SIEM */}
        <div
          data-testid="lab-terminal-card-header"
          className="mb-2 flex flex-wrap items-start justify-between gap-2 bg-secondary border border-border rounded-xl px-3 py-2 shrink-0"
        >
          <div className="min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-text-main leading-tight truncate">
              {activeTabTitle}
            </h2>
            {activeTargetIp && (
              <button
                type="button"
                title={`Copy ${activeTargetLabel} IP`}
                className="mt-0.5 text-xs sm:text-sm text-text-secondary hover:text-brand font-mono rounded focus-ring"
                onClick={() => copyText(activeTargetIp, `${activeTargetLabel} IP`)}
              >
                {activeIpPrefix}: {activeTargetIp}
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {/* The tools this lab uses, as a pop-up instead of a panel tab. */}
            <button
              type="button"
              onClick={() => {
                if (onOpenTools) {
                  onOpenTools()
                } else {
                  setLocalGuideExtra('tools')
                }
              }}
              aria-label="Tools for this lab"
              title="Tools for this lab"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-sm font-semibold text-text-main hover:border-brand/40 hover:text-brand transition focus-ring"
            >
              <Wrench size={16} aria-hidden="true" />
              <span className="hidden sm:inline">Tools</span>
            </button>
            {showOpenDvwa && (
              <>
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

        {/* Pod IPs */}
        {ips && (
          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary shrink-0">
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
          <div className="mb-2 p-3 text-sm border border-border rounded-xl bg-secondary shrink-0">
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

        {/* Floating Side Cue for current task */}
        {currentTaskId != null && currentTaskCue && !expired && (
          <TerminalSideCue key={pod.pod_id} taskId={currentTaskId} cueText={currentTaskCue} variant={currentTaskCueVariant} />
        )}

        {isBrowserLab ? (
          <div className="flex-1 min-h-0 flex flex-col rounded-xl overflow-hidden border border-border bg-white">
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
            <iframe
              key={dvwaNav.nonce}
              src={dvwaNav.path}
              title="DVWA - Damn Vulnerable Web Application"
              className="w-full flex-1 min-h-0 border-0"
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 flex flex-col rounded-xl overflow-hidden border border-border">
            {/* Connection Tabs */}
            <div className="flex flex-wrap bg-secondary border-b border-border shrink-0">
              {termTabs.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => selectTab(tab)}
                  aria-pressed={activeTab === tab}
                  className={`${termTabClass(tab)} ${showOpenSiem && tab === 'meta' ? 'inline-flex items-center gap-1.5 text-warning' : ''}`}
                >
                  {showOpenSiem && tab === 'meta' && <AlertTriangle size={14} aria-hidden="true" />}
                  {TAB_LABEL[tab]}
                  {isMetaWorkLab && tab === 'meta' && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-brand/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand">
                      Scored
                    </span>
                  )}
                </button>
              ))}
            </div>

            {isMetaWorkLab && (
              <div
                data-testid="lab-terminal-status-line"
                className={`flex items-center gap-2 px-3 py-1 text-[11px] font-mono shrink-0 border-b ${
                  activeTab === 'meta'
                    ? 'bg-brand/10 border-brand/30 text-brand'
                    : 'alert-warning rounded-none'
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full shrink-0 bg-current" aria-hidden="true" />
                <span className="truncate">
                  {activeTab === 'meta'
                    ? 'meta · all scored work happens here (msfadmin, sudo)'
                    : 'Kali · optional playground — not scored. Switch to meta for the tasks.'}
                </span>
              </div>
            )}
            {showOpenSiem && (
              <p role="status" className={`px-3 py-2 text-xs border-b shrink-0 ${activeTab === 'meta' ? 'alert-warning rounded-none' : 'bg-muted border-border text-text-muted'}`}>
                {activeTab === 'meta' ? 'You are on meta — save your scored artifact files here.' : 'You are on Kali — generate activity here; write the scored files on meta.'}
              </p>
            )}

            <div className="flex-1 min-h-0 bg-terminal-bg overflow-hidden relative">
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

      <GuideExtraModal
        scenario={scenario}
        podId={pod.pod_id}
        which={activeGuideExtra}
        onClose={handleCloseGuideExtra}
      />

      {/* SIEM dialog (Scenario 3) */}
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
    </div>
  )
}
