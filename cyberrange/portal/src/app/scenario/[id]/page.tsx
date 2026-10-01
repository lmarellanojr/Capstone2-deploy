'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Lightbulb, XCircle } from 'lucide-react'
import { LayoutWrapper } from '@/components/layout/LayoutWrapper'
import { Badge, Button, LoadingSpinner } from '@/components/ui'
import {
  ScenarioInfoView,
  ProvisioningView,
  TerminalView,
  SessionExpiredOverlay,
  BigPictureModal,
} from '@/components/scenario'
import { useScenarios, scenarioDisplayTitle } from '@/hooks/useScenarios'
import { useScenarioPod } from '@/hooks/useScenarioPod'
import { hasSeenBigPicture, markBigPictureSeen } from '@/lib/bigPictureSeen'

interface PageProps {
  params: { id: string }
}

export default function ScenarioDetailPage({ params }: PageProps) {
  const { id: rawId } = params
  const id = rawId.padStart(2, '0')
  const { status: authStatus, data: session } = useSession()
  const router = useRouter()
  const scenarios = useScenarios()

  const scenario = scenarios.find((s) => s.id === id)
  const studentId = session?.user?.name ?? ''

  const { phase, pod, error, startLab, endSession, clearError, fetchedAtMs, lastTtlHours } = useScenarioPod(
    id,
    studentId
  )

  // "Before you start — the big picture" welcome. Auto-opens the first time a
  // student lands on this scenario's pre-lab page; afterwards it's one click
  // away via the header / landing "Big Picture" button.
  const [bigPictureOpen, setBigPictureOpen] = useState(false)
  const autoOpened = useRef(false)

  useEffect(() => {
    if (phase !== 'idle' || !scenario || autoOpened.current) return
    autoOpened.current = true
    if (!hasSeenBigPicture(scenario.id)) {
      markBigPictureSeen(scenario.id)
      setBigPictureOpen(true)
    }
  }, [phase, scenario])

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

  const handleLetsGo = () => {
    setBigPictureOpen(false)
    startLab()
  }

  // LAB-LAYOUT: hide the desktop nav only while a terminal is actually on
  // screen. `!!pod` excludes expired-with-no-pod, which renders
  // SessionExpiredOverlay instead of TerminalView and doesn't need the extra
  // width.
  const hideSidebar = (phase === 'active' || phase === 'expired') && !!pod

  const shellClass = hideSidebar ? 'mx-auto w-full max-w-7xl' : undefined
  const showBigPictureButton = phase === 'idle' || phase === 'provisioning' || (phase === 'active' && !!pod)

  return (
    <LayoutWrapper hideSidebar={hideSidebar}>
      <div className={shellClass}>
      {/* Header bar */}
      <div className="bg-secondary border border-border rounded-xl flex-shrink-0 shadow-card mb-4 -mt-2">
        <div className="px-3 sm:px-4 py-2.5 flex flex-wrap items-center gap-2 sm:gap-3">
          <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0 flex-wrap text-sm">
            <Link
              href="/scenarios"
              className="text-text-muted hover:text-brand transition font-medium rounded focus-ring"
            >
              My Labs
            </Link>
            <ChevronRight size={14} className="text-text-faint" aria-hidden="true" />
            {/* GUIDE-UX-TRIAL / SCEN-UX #116: same "Scenario N -- Name" label
                as the catalog card and the lab info page. */}
            <span className="font-semibold text-text-main min-w-0 break-words" aria-current="page">
              {scenarioDisplayTitle(scenario)}
            </span>
          </nav>
          <div className="sm:ml-auto flex flex-wrap items-center gap-2">
            {phase === 'active' && pod && (
              <Badge variant="success" dot>
                Session active
              </Badge>
            )}
            {/* Time left now lives on the Score panel (TerminalView), next to
                where students track progress. */}
            {showBigPictureButton && (
              <Button variant="outline" size="sm" onClick={() => setBigPictureOpen(true)}>
                <Lightbulb size={14} className="text-brand" aria-hidden="true" />
                Big Picture
              </Button>
            )}
          </div>
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
            onShowBigPicture={() => setBigPictureOpen(true)}
          />
        )}

        {/* Provisioning — animated step tracker */}
        {phase === 'provisioning' && (
          <ProvisioningView scenario={scenario} onShowBigPicture={() => setBigPictureOpen(true)} />
        )}

        {/* Active — IFrame + milestones */}
        {phase === 'active' && pod && (
          <TerminalView
            pod={pod}
            scenario={scenario}
            onEnd={endSession}
            ttlGrace={pod.ttl_expired}
            fetchedAtMs={fetchedAtMs}
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
          <div className="max-w-md mx-auto w-full">
            <div className="card-surface text-center px-6 sm:px-8 py-10" role="alert">
              <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 text-danger">
                <XCircle size={28} aria-hidden="true" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Your lab couldn&apos;t start</h2>
              {error === 'ALREADY_HAS_POD' ? (
                <>
                  <p className="text-text-secondary mb-8">
                    You already have a lab running. End it from your dashboard before starting a new one.
                  </p>
                  <div className="flex flex-wrap gap-3 justify-center">
                    <Button variant="primary" onClick={() => router.push('/dashboard')}>
                      Go to dashboard
                    </Button>
                    <Button variant="secondary" onClick={() => router.push('/scenarios')}>
                      Back to My Labs
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-text-secondary mb-2">
                    {error === 'POD_CAP_REACHED'
                      ? 'All lab slots are currently full. Please wait for another student to finish.'
                      : error === 'STORAGE_FULL'
                        ? 'The lab server is out of disk space right now, so a new lab can’t be created.'
                        : error === 'RAM_FULL'
                          ? 'The lab server is out of memory right now, so a new lab can’t be created.'
                          : error || 'Something went wrong while setting up your lab.'}
                  </p>
                  {error !== 'POD_CAP_REACHED' && error !== 'STORAGE_FULL' && error !== 'RAM_FULL' && (
                    <p className="text-text-muted text-sm mb-8">
                      Anything half-created was cleaned up automatically. You can try again.
                    </p>
                  )}
                  {(error === 'POD_CAP_REACHED' || error === 'STORAGE_FULL' || error === 'RAM_FULL') && (
                    <div className="mb-8" />
                  )}
                  <div className="flex flex-wrap gap-3 justify-center">
                    {error !== 'POD_CAP_REACHED' && (
                      <Button variant="primary" onClick={handleRetry}>
                        Try again
                      </Button>
                    )}
                    <Button variant="secondary" onClick={() => router.push('/scenarios')}>
                      Back to My Labs
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      </div>

      <BigPictureModal
        scenario={scenario}
        isOpen={bigPictureOpen}
        onClose={() => setBigPictureOpen(false)}
        onStart={phase === 'idle' ? handleLetsGo : undefined}
        podId={phase === 'active' && pod ? pod.pod_id : undefined}
      />
    </LayoutWrapper>
  )
}
