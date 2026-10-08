/** @jest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { ExercisePanel } from './ExercisePanel'
import { Milestone, Scenario } from '@/hooks/useScenarios'
import { Pod } from '@/lib/api'

jest.mock('@/context/ToastContext', () => ({
  useToastContext: () => ({ success: jest.fn(), warning: jest.fn(), error: jest.fn() }),
}))

jest.mock('@/components/scenario/GuideView', () => ({
  GuideView: ({ taskNumber, taskNumberPinned }: { taskNumber?: number; taskNumberPinned?: boolean }) => (
    <div
      data-testid="guide-view-content"
      data-task-number={taskNumber}
      data-task-number-pinned={String(!!taskNumberPinned)}
    >
      Guide Content
    </div>
  ),
}))

describe('ExercisePanel', () => {
  const mockPod: Pod = {
    pod_id: 1,
    student_id: 'student',
    status: 'ACTIVE',
    vmid_kali: null,
    vmid_meta: null,
    vmid_dvwa: null,
    connection_id: null,
    wazuh_agent_id: null,
    scenario_id: '01',
    created_at: null,
    last_heartbeat: null,
    ttl_minutes: 30,
    remaining_seconds: 300,
    expires_at: null,
    ttl_expired: false,
  }

  const mockScenario: Scenario = {
    id: '01',
    displayNumber: 1,
    name: 'Network Reconnaissance',
    type: 'offensive',
    description: 'Recon lab',
    mitre: 'T1046',
    difficulty: 1,
    guideFile: 'scenario_01_network_reconnaissance.md',
    milestones: [
      {
        id: 1,
        name: 'Host Discovery',
        goal: 'Run a host-discovery sweep',
        description: 'Scan subnet for hosts',
        points: 50,
      },
    ],
  }

  const mockTask: Milestone = mockScenario.milestones[0]

  it('renders task header, goal instructions, points, and typing guidance', () => {
    render(
      <ExercisePanel
        pod={mockPod}
        scenario={mockScenario}
        currentTask={mockTask}
        taskIndex={0}
        totalTasks={1}
        completed={false}
        isFlag={false}
        lockedReview={false}
        verifying={false}
        milestonesLoading={false}
        onVerify={jest.fn()}
        onFlagPass={jest.fn()}
        onRequestReview={jest.fn()}
      />
    )

    expect(screen.getByText('Task 1 of 1')).toBeTruthy()
    expect(screen.getByText('50 pts')).toBeTruthy()
    expect(screen.getByText('Host Discovery')).toBeTruthy()
    expect(screen.getByText('Run a host-discovery sweep')).toBeTruthy()
    expect(screen.getByText('Scan subnet for hosts')).toBeTruthy()
    expect(
      screen.getByText(/Type the commands yourself; Copy is in the Guide below/i)
    ).toBeTruthy()
  })

  it('hides the commands hint on a flag task (Status already covers it)', () => {
    render(
      <ExercisePanel
        pod={mockPod}
        scenario={mockScenario}
        currentTask={mockTask}
        taskIndex={4}
        totalTasks={5}
        completed={false}
        isFlag
        lockedReview={false}
        verifying={false}
        milestonesLoading={false}
        onVerify={jest.fn()}
        onFlagPass={jest.fn()}
        onRequestReview={jest.fn()}
      />
    )

    // The flag Status area already says it's the one step you submit yourself.
    expect(screen.getByText(/This is the one step you submit yourself\./i)).toBeTruthy()
    // The copy-the-commands hint is suppressed for the flag task.
    expect(
      screen.queryByText(/Type the commands yourself; Copy is in the Guide below/i)
    ).toBeNull()
  })

  it('keeps GuideView mounted in DOM for PDF export portal even when guide is collapsed', () => {
    render(
      <ExercisePanel
        pod={mockPod}
        scenario={mockScenario}
        currentTask={mockTask}
        taskIndex={0}
        totalTasks={1}
        completed={false}
        isFlag={false}
        lockedReview={false}
        verifying={false}
        milestonesLoading={false}
        onVerify={jest.fn()}
        onFlagPass={jest.fn()}
        onRequestReview={jest.fn()}
      />
    )

    // Guide view content MUST exist in DOM so #guide-print-root is attached
    expect(screen.getByTestId('guide-view-content')).toBeTruthy()

    // Toggle guide open
    const toggleBtn = screen.getByRole('button', { name: /Walkthrough for this task/i })
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggleBtn)
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true')
  })

  it('passes the positional task number to GuideView when the milestone has no guideTaskNumber', () => {
    render(
      <ExercisePanel
        pod={mockPod}
        scenario={mockScenario}
        currentTask={mockTask}
        taskIndex={2}
        totalTasks={5}
        completed={false}
        isFlag={false}
        lockedReview={false}
        verifying={false}
        milestonesLoading={false}
        onVerify={jest.fn()}
        onFlagPass={jest.fn()}
        onRequestReview={jest.fn()}
      />
    )

    const guide = screen.getByTestId('guide-view-content')
    expect(guide).toHaveAttribute('data-task-number', '3') // taskIndex + 1
    expect(guide).toHaveAttribute('data-task-number-pinned', 'false')
  })

  it('passes a pinned guideTaskNumber to GuideView when the milestone sets one', () => {
    const pinnedTask: Milestone = { ...mockTask, guideTaskNumber: 0 }
    render(
      <ExercisePanel
        pod={mockPod}
        scenario={{ ...mockScenario, milestones: [pinnedTask] }}
        currentTask={pinnedTask}
        taskIndex={1}
        totalTasks={3}
        completed={false}
        isFlag={false}
        lockedReview={false}
        verifying={false}
        milestonesLoading={false}
        onVerify={jest.fn()}
        onFlagPass={jest.fn()}
        onRequestReview={jest.fn()}
      />
    )

    const guide = screen.getByTestId('guide-view-content')
    expect(guide).toHaveAttribute('data-task-number', '0') // guideTaskNumber wins over index + 1
    expect(guide).toHaveAttribute('data-task-number-pinned', 'true')
  })

  it('triggers manual verification on check button click', () => {
    const onVerify = jest.fn()
    render(
      <ExercisePanel
        pod={mockPod}
        scenario={mockScenario}
        currentTask={mockTask}
        taskIndex={0}
        totalTasks={1}
        completed={false}
        isFlag={false}
        lockedReview={false}
        verifying={false}
        milestonesLoading={false}
        onVerify={onVerify}
        onFlagPass={jest.fn()}
        onRequestReview={jest.fn()}
      />
    )

    const checkBtn = screen.getByRole('button', { name: /Manual Check/i })
    fireEvent.click(checkBtn)
    expect(onVerify).toHaveBeenCalledWith(1)
  })

  it('displays locked instructor review notice when lockedReview is true', () => {
    render(
      <ExercisePanel
        pod={mockPod}
        scenario={mockScenario}
        currentTask={mockTask}
        taskIndex={0}
        totalTasks={1}
        completed={false}
        isFlag={false}
        lockedReview={true}
        verifying={false}
        milestonesLoading={false}
        onVerify={jest.fn()}
        onFlagPass={jest.fn()}
        onRequestReview={jest.fn()}
      />
    )

    expect(
      screen.getByText(/Automated check couldn't verify this task/i)
    ).toBeTruthy()
    expect(
      screen.getByRole('button', { name: /Ask an instructor to check this task/i })
    ).toBeTruthy()
  })

  it('disables scoring actions and shows expired message when expired is true', () => {
    const onVerify = jest.fn()
    render(
      <ExercisePanel
        pod={mockPod}
        scenario={mockScenario}
        currentTask={mockTask}
        taskIndex={0}
        totalTasks={1}
        completed={false}
        isFlag={false}
        lockedReview={false}
        verifying={false}
        milestonesLoading={false}
        expired={true}
        onVerify={onVerify}
        onFlagPass={jest.fn()}
        onRequestReview={jest.fn()}
      />
    )

    const checkBtn = screen.getByRole('button', { name: /Manual Check/i })
    expect(checkBtn).toBeDisabled()
    fireEvent.click(checkBtn)
    expect(onVerify).not.toHaveBeenCalled()

    expect(screen.getByText(/Lab session expired\. Start a new session to verify your work\./i)).toBeTruthy()
    expect(screen.getByText(/Lab session expired — instructor review unavailable\./i)).toBeTruthy()
    expect(screen.getByText(/Lab session expired\. Scoring is unavailable\./i)).toBeTruthy()
  })
})
