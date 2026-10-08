'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Clock, Lightbulb, XCircle } from 'lucide-react'
import { LayoutWrapper } from '@/components/layout/LayoutWrapper'
import { Badge, Button, LoadingSpinner, Modal, ModalHeader, ModalBody, ModalFooter } from '@/components/ui'
import {
  ScenarioInfoView,
  ProvisioningView,
  TerminalView,
  SessionExpiredOverlay,
  BigPictureModal,
  LabCountdown,
  DvwaView,
} from '@/components/scenario'
import { ExercisePanel } from '@/components/scenario/ExercisePanel'
import { ScenarioOutline } from '@/components/scenario/ScenarioOutline'
import { GuideExtraModal, type GuideExtra } from '@/components/scenario/GuideExtraModal'
import { VerificationRequestModal } from '@/components/reviews/VerificationRequestModal'
import { useScenarios, scenarioDisplayTitle, isFlagMilestone, getLabSurface } from '@/hooks/useScenarios'
import { useScenarioPod } from '@/hooks/useScenarioPod'
import { useScenarioMilestones } from '@/hooks/useScenarioMilestones'
import { useMyReviews } from '@/hooks/useMyReviews'
import { useToastContext } from '@/context/ToastContext'
import { uploadScreenshots } from '@/lib/screenshotUpload'
import { hasSeenBigPicture, markBigPictureSeen } from '@/lib/bigPictureSeen'
import { destroySession, sessionKey } from '@/components/terminal/terminalSessionManager'
import { isScenarioComplete } from '@/lib/scenarioCompletion'

interface PageProps {
  params: { id: string }
}

export default function ScenarioDetailPage({ params }: PageProps) {
  const { id: rawId } = params
  const id = rawId.padStart(2, '0')
  const { status: authStatus, data: session } = useSession()
  const router = useRouter()
  const scenarios = useScenarios()
  const { success, warning } = useToastContext()

  const scenario = scenarios.find((s) => s.id === id)
  const studentId = session?.user?.name ?? ''

  const { phase, pod, error, startLab, endSession, clearError, fetchedAtMs, lastTtlMinutes } = useScenarioPod(
    id,
    studentId
  )

  // Unconditional hook execution: single polling source for milestone state
  const milestones = useMemo(() => scenario?.milestones ?? [], [scenario])
  const {
    completed,
    lockedReview,
    verifying,
    milestonesLoading,
    loadedProgressKey,
    currentProgressKey,
    earnedPoints,
    totalPoints,
    doneCount,
    progressPct,
    nextMilestoneId,
    handleVerify,
    onFlagPassed,
  } = useScenarioMilestones(
    pod ? pod.pod_id : null,
    scenario ? scenario.id : undefined,
    milestones
  )

  const myReviews = useMyReviews()
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null)
  const [guideExtra, setGuideExtra] = useState<GuideExtra | null>(null)
  const [requestFor, setRequestFor] = useState<{ milestoneId: number; mode: 'new' | 'retry' } | null>(null)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [ending, setEnding] = useState(false)
  const [showCompletion, setShowCompletion] = useState(false)

  // "Before you start — the big picture" welcome
  const [bigPictureOpen, setBigPictureOpen] = useState(false)
  const autoOpened = useRef(false)

  // Auto-advance active task when the selected task completes
  const prevCompletedRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    if (
      selectedTaskId !== null &&
      completed.has(selectedTaskId) &&
      !prevCompletedRef.current.has(selectedTaskId)
    ) {
      setSelectedTaskId(null)
    }
    prevCompletedRef.current = new Set(completed)
  }, [completed, selectedTaskId])

  // Current active task
  const currentTaskId = selectedTaskId ?? nextMilestoneId ?? scenario?.milestones[0]?.id ?? 1
  const currentTaskIndex = scenario
    ? Math.max(0, scenario.milestones.findIndex((m) => m.id === currentTaskId))
    : 0
  const currentMilestone = scenario?.milestones[currentTaskIndex]

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

  // Completion modal trigger
  useEffect(() => {
    if (milestonesLoading || !scenario) return
    if (
      isScenarioComplete({
        scenarioId: scenario.id,
        requiredMilestoneIds: scenario.milestones.map((milestone) => milestone.id),
        completedMilestoneIds: completed,
        currentProgressKey,
        loadedProgressKey,
      })
    ) {
      setShowCompletion(true)
    }
  }, [completed, currentProgressKey, loadedProgressKey, milestonesLoading, scenario])

  const teardown = useCallback(() => {
    setEnding(true)
    if (pod) {
      destroySession(sessionKey(pod.pod_id, 'kali'))
      destroySession(sessionKey(pod.pod_id, 'meta'))
      destroySession(sessionKey(pod.pod_id, 'dvwa'))
    }
    endSession()
    router.push('/dashboard')
  }, [endSession, router, pod])

  const latestRequest = useCallback(
    (milestoneId: number) =>
      scenario
        ? myReviews.items.find(
            (i) => i.tracked.scenarioId === scenario.id && i.tracked.milestoneId === milestoneId
          )
        : undefined,
    [myReviews.items, scenario]
  )
  const activeRequest = requestFor ? latestRequest(requestFor.milestoneId) : undefined
  const requestMilestone = requestFor && scenario
    ? scenario.milestones.find((m) => m.id === requestFor.milestoneId)
    : undefined

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

  const hideSidebar = (phase === 'active' || phase === 'expired') && !!pod
  const shellClass = hideSidebar
    ? 'mx-auto w-full max-w-7xl xl:max-w-[88rem] 2xl:max-w-[104rem] flex flex-col h-[calc(100dvh-5.5rem)] min-h-0'
    : undefined
  const showBigPictureButton = phase === 'idle' || phase === 'provisioning' || (phase === 'active' && !!pod)

  return (
    <LayoutWrapper hideSidebar={hideSidebar}>
      <div className={shellClass}>
        {/* Header bar */}
        <div className="bg-secondary border border-border rounded-xl flex-shrink-0 shadow-card mb-3 -mt-2">
          <div className="px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 sm:gap-3">
            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 min-w-0 flex-wrap text-sm">
              <Link
                href="/scenarios"
                className="text-text-muted hover:text-brand transition font-medium rounded focus-ring"
              >
                My Labs
              </Link>
              <ChevronRight size={14} className="text-text-faint" aria-hidden="true" />
              <span className="font-semibold text-text-main min-w-0 break-words" aria-current="page">
                {scenarioDisplayTitle(scenario)}
              </span>
            </nav>

            {/* Stepper / Outline in header */}
            {phase === 'active' && pod && (
              <div className="order-last sm:order-none w-full sm:w-auto flex justify-center sm:justify-start">
                <ScenarioOutline
                  tasks={scenario.milestones}
                  currentTaskId={currentTaskId}
                  completedTaskIds={completed}
                  onSelectTask={setSelectedTaskId}
                />
              </div>
            )}

            <div className="flex items-center gap-2">
              {phase === 'active' && pod && (
                <Badge variant="success" dot>
                  Session active
                </Badge>
              )}
              {showBigPictureButton && (
                <Button variant="outline" size="sm" onClick={() => setBigPictureOpen(true)}>
                  <Lightbulb size={14} className="text-brand" aria-hidden="true" />
                  Big Picture
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Content area */}
        <div
          className={
            phase === 'active' || phase === 'expired'
              ? 'flex-1 min-h-0 flex flex-col overflow-hidden'
              : 'flex-1 overflow-auto px-2 sm:px-8 py-6 sm:py-10'
          }
        >
          {phase === 'loading' && (
            <div className="flex items-center justify-center w-full h-full">
              <LoadingSpinner message="Checking session status…" />
            </div>
          )}

          {phase === 'idle' && (
            <ScenarioInfoView
              scenario={scenario}
              onStart={startLab}
              loading={false}
              error={error}
              onShowBigPicture={() => setBigPictureOpen(true)}
            />
          )}

          {phase === 'provisioning' && (
            <ProvisioningView scenario={scenario} onShowBigPicture={() => setBigPictureOpen(true)} />
          )}

          {/* Active / Expired: Two-Pane Split Layout */}
          {((phase === 'active' && pod) || (phase === 'expired' && pod)) && (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex-1 min-h-0 grid grid-cols-1 min-[900px]:grid-cols-[380px_1fr] gap-3 mb-3 overflow-y-auto min-[900px]:overflow-hidden">
                {/* Left Pane: ExercisePanel */}
                {currentMilestone && (
                  <div className="min-h-0 h-full">
                    <ExercisePanel
                      pod={pod}
                      scenario={scenario}
                      currentTask={currentMilestone}
                      taskIndex={currentTaskIndex}
                      totalTasks={scenario.milestones.length}
                      completed={completed.has(currentMilestone.id)}
                      isFlag={isFlagMilestone(scenario.id, currentMilestone.id)}
                      lockedReview={lockedReview.has(currentMilestone.id)}
                      verifying={verifying.has(currentMilestone.id)}
                      milestonesLoading={milestonesLoading}
                      expired={phase === 'expired'}
                      onVerify={handleVerify}
                      onFlagPass={onFlagPassed}
                      onRequestReview={(milestoneId, mode) => setRequestFor({ milestoneId, mode })}
                      hasLatestReview={!!latestRequest(currentMilestone.id)}
                      latestReviewStatus={latestRequest(currentMilestone.id)?.case?.status}
                      onOpenScoringInfo={() => setGuideExtra('scoring')}
                    />
                  </div>
                )}

                {/* Right Pane: Pluggable by scenario surface (TerminalView / DvwaView) */}
                <div className="min-w-0 min-h-0 h-full flex flex-col">
                  {getLabSurface(scenario) === 'dvwa' ? (
                    <DvwaView
                      pod={pod}
                      scenario={scenario}
                      currentTaskId={currentTaskId}
                      currentTaskCue={currentMilestone?.cue}
                      expired={phase === 'expired'}
                      ttlGrace={pod.ttl_expired}
                      canRestart={false}
                    />
                  ) : (
                    <TerminalView
                      pod={pod}
                      scenario={scenario}
                      onEnd={endSession}
                      ttlGrace={pod.ttl_expired}
                      fetchedAtMs={fetchedAtMs}
                      expired={phase === 'expired'}
                      canRestart={false}
                      currentTaskId={currentTaskId}
                      currentTaskCue={currentMilestone?.cue}
                      externalGuideExtra={guideExtra}
                      onCloseGuideExtra={() => setGuideExtra(null)}
                      onOpenTools={() => setGuideExtra('tools')}
                    />
                  )}
                </div>
              </div>

              {/* Footer bar */}
              <div className="bg-secondary border border-border rounded-xl px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0 shadow-card">
                <div className="flex items-center gap-4 min-w-0">
                  <div>
                    <span className="text-[11px] text-text-muted font-semibold uppercase tracking-wider block">
                      Score
                    </span>
                    <span className="text-base sm:text-lg font-bold tabular-nums text-text-main">
                      {milestonesLoading ? 'Loading…' : `${earnedPoints} / ${totalPoints} pts`}
                    </span>
                  </div>
                  {phase === 'active' && pod.expires_at && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-text-muted border-l border-border pl-4">
                      <Clock size={14} aria-hidden="true" />
                      <LabCountdown remainingSeconds={pod.remaining_seconds} fetchedAtMs={fetchedAtMs} />
                    </span>
                  )}
                  <div className="hidden md:flex items-center gap-3 border-l border-border pl-4">
                    <span className="text-xs text-text-muted font-medium">
                      {doneCount} of {scenario.milestones.length} tasks done
                    </span>
                    <div
                      className="h-2 w-24 sm:w-28 rounded-full bg-muted overflow-hidden"
                      role="progressbar"
                      aria-label="Lab progress"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={milestonesLoading ? 0 : progressPct}
                    >
                      <div
                        className="h-full rounded-full bg-brand transition-all duration-500"
                        style={{ width: `${milestonesLoading ? 0 : progressPct}%` }}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    variant="danger-outline"
                    size="sm"
                    onClick={() => setShowEndConfirm(true)}
                  >
                    End Session
                  </Button>
                </div>
              </div>
            </div>
          )}

          {phase === 'expired' && !pod && (
            <SessionExpiredOverlay
              ttlMinutes={lastTtlMinutes}
              onRestart={handleRetry}
              onDashboard={() => router.push('/dashboard')}
            />
          )}

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

      {pod && getLabSurface(scenario) === 'dvwa' && (
        <GuideExtraModal
          scenario={scenario}
          podId={pod.pod_id}
          which={guideExtra}
          onClose={() => setGuideExtra(null)}
        />
      )}

      {/* Verification request modal */}
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
            const failed = data.images.length ? await uploadScreenshots(reviewId, data.images) : []
            success('Request sent. Your instructor will reply on your dashboard.')
            if (failed.length) warning(`Some screenshots couldn't be attached: ${failed.join(' ')}`)
          }}
        />
      )}

      {/* End Session Confirmation Modal */}
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

      {/* Completion Modal */}
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
    </LayoutWrapper>
  )
}
