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
  GuideView: () => <div data-testid="guide-view-content">Guide Content</div>,
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
    ttl_hours: 1,
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
    const toggleBtn = screen.getByRole('button', { name: /Walkthrough Guide/i })
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(toggleBtn)
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true')
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
})
