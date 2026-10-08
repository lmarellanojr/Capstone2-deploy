/** @jest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom'
import { render, screen, waitFor } from '@testing-library/react'
import ScenarioDetailPage from './page'
import { SCENARIOS, getLabSurface } from '@/hooks/useScenarios'

jest.mock('react-markdown', () => {
  return function MockReactMarkdown({ children }: { children: React.ReactNode }) {
    return <div>{children}</div>
  }
})
jest.mock('remark-gfm', () => () => {})
jest.mock('rehype-sanitize', () => () => {})

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/scenario/01',
  notFound: jest.fn(),
}))

jest.mock('next-auth/react', () => ({
  useSession: () => ({
    status: 'authenticated',
    data: { user: { name: 'student' }, accessToken: 'token' },
  }),
}))

jest.mock('@/context/ToastContext', () => ({
  useToastContext: () => ({ success: jest.fn(), warning: jest.fn(), error: jest.fn() }),
}))

jest.mock('@/hooks/useScenarioPod', () => ({
  useScenarioPod: (id: string) => ({
    phase: 'active',
    pod: {
      pod_id: 1,
      student_id: 'student',
      status: 'ACTIVE',
      vmid_kali: null,
      vmid_meta: null,
      vmid_dvwa: null,
      connection_id: null,
      wazuh_agent_id: null,
      scenario_id: id,
      created_at: null,
      last_heartbeat: null,
      ttl_minutes: 60,
      remaining_seconds: 300,
      expires_at: null,
      ttl_expired: false,
    },
    error: null,
    startLab: jest.fn(),
    endSession: jest.fn(),
    clearError: jest.fn(),
    fetchedAtMs: Date.now(),
    lastTtlHours: 1,
  }),
}))

jest.mock('@/hooks/useScenarioMilestones', () => ({
  useScenarioMilestones: jest.fn(() => ({
    completed: new Set(),
    lockedReview: new Set(),
    verifying: new Set(),
    milestonesLoading: false,
    loadedProgressKey: 'key',
    currentProgressKey: 'key',
    earnedPoints: 0,
    totalPoints: 350,
    doneCount: 0,
    progressPct: 0,
    nextMilestoneId: 1,
    handleVerify: jest.fn(),
    onFlagPassed: jest.fn(),
  })),
}))

jest.mock('@/lib/scenarioCompletion', () => ({
  isScenarioComplete: jest.fn(() => false),
}))

jest.mock('@/hooks/useMyReviews', () => ({
  useMyReviews: () => ({ items: [], submit: jest.fn(), resubmit: jest.fn() }),
}))

jest.mock('@/components/terminal/terminalSessionManager', () => ({
  destroySession: jest.fn(),
  sessionKey: jest.fn(() => 'key'),
}))

jest.mock('@/components/scenario/TerminalView', () => ({
  TerminalView: () => <div data-testid="mock-terminal-view">Terminal View</div>,
}))

jest.mock('@/components/scenario/LabSurface', () => ({
  LabSurface: ({ scenario }: { scenario: { id: string } }) => (
    <div data-testid={`mock-${scenario.id === '06' ? 'dvwa' : scenario.id === '09' ? 'siem' : 'terminal'}-view`} />
  ),
}))

jest.mock('@/components/scenario/DvwaView', () => ({
  DvwaView: () => <div data-testid="mock-dvwa-view">DVWA View</div>,
}))

jest.mock('@/components/scenario/ExercisePanel', () => ({
  ExercisePanel: ({ currentTask }: { currentTask: { id: number } }) => (
    <div data-testid="mock-exercise-panel" data-task-id={currentTask.id}>Exercise Panel</div>
  ),
}))

jest.mock('@/components/scenario/ScenarioOutline', () => ({
  ScenarioOutline: ({ tasks, currentTaskId, startNumber }: { tasks: { id: number }[]; currentTaskId: number; startNumber: number }) => (
    <div
      data-testid="mock-scenario-outline"
      data-task-ids={tasks.map((task) => task.id).join(',')}
      data-current-task-id={currentTaskId}
      data-start-number={startNumber}
    />
  ),
}))

jest.mock('@/components/scenario/BigPictureModal', () => ({
  BigPictureModal: () => null,
}))

jest.mock('@/components/scenario/GuideExtraModal', () => ({
  GuideExtraModal: () => null,
}))

describe('ScenarioDetailPage right-pane surface selection', () => {
  it('correctly maps labSurface metadata across scenarios', () => {
    const s1 = SCENARIOS.find((s) => s.id === '01')
    const s2 = SCENARIOS.find((s) => s.id === '06')
    const s3 = SCENARIOS.find((s) => s.id === '09')
    const s4 = SCENARIOS.find((s) => s.id === '11')

    expect(getLabSurface(s1)).toBe('terminal')
    expect(getLabSurface(s2)).toBe('dvwa')
    expect(getLabSurface(s3)).toBe('siem')
    expect(getLabSurface(s4)).toBe('terminal')
  })

  it('renders TerminalView for Scenario 1 (reconnaissance)', () => {
    render(<ScenarioDetailPage params={{ id: '01' }} />)
    expect(screen.getByTestId('mock-terminal-view')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-dvwa-view')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-exercise-panel')).toBeInTheDocument()
  })

  it('renders DvwaView for Scenario 2 (SQL Injection & XSS)', () => {
    render(<ScenarioDetailPage params={{ id: '06' }} />)
    expect(screen.getByTestId('mock-dvwa-view')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-terminal-view')).not.toBeInTheDocument()
    expect(screen.getByTestId('mock-exercise-panel')).toBeInTheDocument()
  })

  it('keeps Scenario 3 prep in presentation while scoring and completion use only scored milestones', async () => {
    const useMilestonesMock = jest.requireMock('@/hooks/useScenarioMilestones').useScenarioMilestones as jest.Mock
    const isScenarioCompleteMock = jest.requireMock('@/lib/scenarioCompletion').isScenarioComplete as jest.Mock
    useMilestonesMock.mockClear()
    isScenarioCompleteMock.mockClear()

    render(<ScenarioDetailPage params={{ id: '09' }} />)

    const scenario3 = SCENARIOS.find((scenario) => scenario.id === '09')!
    await waitFor(() => {
      expect(screen.getByTestId('mock-exercise-panel')).toHaveAttribute('data-task-id', '0')
      expect(screen.getByTestId('mock-scenario-outline')).toHaveAttribute('data-current-task-id', '0')
    })

    expect(screen.getByTestId('mock-scenario-outline')).toHaveAttribute('data-task-ids', '0,1,2,3')
    expect(screen.getByTestId('mock-scenario-outline')).toHaveAttribute('data-start-number', '0')
    expect(useMilestonesMock).toHaveBeenCalledWith(1, '09', scenario3.milestones)
    expect(scenario3.milestones.map((milestone) => milestone.id)).toEqual([1, 2, 3])
    expect(isScenarioCompleteMock).toHaveBeenCalledWith(expect.objectContaining({
      scenarioId: '09',
      requiredMilestoneIds: [1, 2, 3],
    }))
    expect(screen.getByTestId('mock-siem-view')).toBeInTheDocument()
  })
})
