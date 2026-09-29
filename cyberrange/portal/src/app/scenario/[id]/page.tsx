'use client'

import { useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { notFound } from 'next/navigation'
import { LayoutWrapper } from '@/components/layout/LayoutWrapper'
import { LoadingSpinner } from '@/components/ui'
import { Button } from '@/components/ui'
import { ScenarioInfoView, ProvisioningView, TerminalView, LabCountdown, SessionExpiredOverlay } from '@/components/scenario'
import { useScenarios, scenarioDisplayTitle } from '@/hooks/useScenarios'
import { useScenarioPod } from '@/hooks/useScenarioPod'

interface PageProps {
  params: { id: string }
}

export default function ScenarioDetailPage({ params }: PageProps) {
  const { id: rawId } = params
  const id = rawId.padStart(2, '0')
  const { data: session, status: authStatus } = useSession()
  const router = useRouter()
  const scenarios = useScenarios()

  const scenario = scenarios.find((s) => s.id === id)
  const studentId = session?.user?.name ?? ''

  const { phase, pod, error, startLab, endSession, clearError, fetchedAtMs, lastTtlHours } = useScenarioPod(
    id,
    studentId
  )

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      router.push(`/login?callbackUrl=/scenario/${id}`)
    }
  }, [authStatus, id, router])

  if (authStatus === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-primary">
        <LoadingSpinner message="Loading..." />
      </div>
    )
  }

  if (authStatus === 'unauthenticated') return null

  if (!scenario) return notFound()

  const handleRetry = () => {
    clearError()
    startLab()
  }

  // LAB-LAYOUT: hide the desktop nav only while a terminal is actually on
  // screen. `!!pod` excludes expired-with-no-pod, which renders
  // SessionExpiredOverlay instead of TerminalView and doesn't need the extra
  // width.
  const hideSidebar = (phase === 'active' || phase === 'expired') && !!pod

  const shellClass = hideSidebar ? 'mx-auto w-full max-w-7xl' : undefined

  return (
    <LayoutWrapper hideSidebar={hideSidebar}>
      <div className={shellClass}>
      {/* Header bar */}
      <div className="bg-secondary border border-border rounded-lg flex-shrink-0 shadow-card mb-4 -mt-2">
        <div className="px-3 sm:px-4 py-3 flex flex-wrap items-center gap-2 sm:gap-4">
          <nav aria-label="Breadcrumb" className="flex items-center gap-2 min-w-0 flex-wrap">
            <button
              type="button"
              onClick={() => router.push('/scenarios')}
              className="text-text-muted hover:text-brand transition text-sm font-medium"
            >
              My Labs
            </button>
            <span className="text-border" aria-hidden="true">›</span>
            {/* GUIDE-UX-TRIAL / SCEN-UX #116: same "Scenario N -- Name" label
                as the catalog card and the lab info page. */}
            <span className="font-semibold text-text-main min-w-0 break-words">
              {scenarioDisplayTitle(scenario)}
            </span>
          </nav>
          {phase === 'active' && pod && (
            <span className="sm:ml-auto text-xs text-success font-semibold bg-green-50 px-2 py-1 rounded-full border border-green-200 whitespace-nowrap">
              Pod {pod.pod_id} · ACTIVE
            </span>
          )}
          {phase === 'active' && pod && pod.expires_at && (
            <LabCountdown remainingSeconds={pod.remaining_seconds} fetchedAtMs={fetchedAtMs} />
          )}
        </div>
      </div>

      {/* Content area — BUG-035 height stays on this sibling, not the max-w wrapper */}
      <div
        className={
          phase === 'active' || phase === 'expired'
            ? // BUG-035: terminal phases need a definite (bounded) height so the chain
              // down to XtermView/FitAddon resolves to real pixels. Subtract the TopNav
              // (4rem), p-8 wrapper (2rem top/bottom), and the scenario header bar (~3.5rem).
              'flex p-0 sm:p-2 lg:p-4 overflow-y-auto xl:overflow-hidden h-[calc(100dvh-9.5rem)] sm:h-[calc(100dvh-11.5rem)] min-h-0'
            : 'flex-1 overflow-auto px-2 sm:px-8 py-6 sm:py-10'
        }
      >
        {/* Loading (initial pod check) */}
        {phase === 'loading' && (
          <div className="flex items-center justify-center w-full h-full">
            <LoadingSpinner message="Checking session status…" />
          </div>
        )}

        {/* Idle — show scenario info + start button */}
        {phase === 'idle' && (
          <ScenarioInfoView
            scenario={scenario}
            onStart={startLab}
            loading={false}
            error={error}
          />
        )}

        {/* Provisioning — animated step tracker */}
        {phase === 'provisioning' && <ProvisioningView />}

        {/* Active — IFrame + milestones */}
        {phase === 'active' && pod && (
          <TerminalView
            pod={pod}
            scenario={scenario}
            onEnd={endSession}
            ttlGrace={pod.ttl_expired}
          />
        )}

        {phase === 'expired' && pod && (
          <TerminalView
            pod={pod}
            scenario={scenario}
            onEnd={endSession}
            expired
            canRestart={false}
          />
        )}

        {phase === 'expired' && !pod && (
          <SessionExpiredOverlay
            ttlHours={lastTtlHours}
            onRestart={handleRetry}
            onDashboard={() => router.push('/dashboard')}
          />
        )}

        {/* Failed provisioning */}
        {phase === 'failed' && (
          <div className="max-w-md mx-auto text-center py-16">
            <div className="text-5xl mb-4">❌</div>
            <h2 className="text-2xl font-bold mb-2">Provisioning Failed</h2>
            {error === 'ALREADY_HAS_POD' ? (
              <>
                <p className="text-text-muted mb-8">
                  You already have an active lab session. Please destroy it from your dashboard before starting a new one.
                </p>
                <div className="flex gap-3 justify-center">
                  <Button variant="primary" onClick={() => router.push('/dashboard')}>
                    Go to Dashboard
                  </Button>
                  <Button variant="secondary" onClick={() => router.push('/scenarios')}>
                    Back to Scenarios
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-text-muted mb-2">
                  {error === 'POD_CAP_REACHED'
                    ? 'All lab slots are currently full. Please wait for another student to finish.'
                    : error === 'STORAGE_FULL'
                      ? 'The host does not have enough disk space in the LXD pool to start a new lab.'
                      : error === 'RAM_FULL'
                        ? 'The host does not have enough free memory to start a new pod.'
                        : error || 'Failed to start lab environment.'}
                </p>
                {error !== 'POD_CAP_REACHED' && error !== 'STORAGE_FULL' && error !== 'RAM_FULL' && (
                  <p className="text-text-muted text-sm mb-8">
                    The environment was automatically cleaned up. You can try again.
                  </p>
                )}
                <div className="flex gap-3 justify-center">
                  {error !== 'POD_CAP_REACHED' && (
                    <Button variant="primary" onClick={handleRetry}>
                      Try Again
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => router.push('/scenarios')}>
                    Back to Scenarios
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      </div>
    </LayoutWrapper>
  )
}
