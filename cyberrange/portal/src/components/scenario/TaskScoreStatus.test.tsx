/** @jest-environment jsdom */
import React from 'react'
import { render, screen } from '@testing-library/react'
import { TaskScoreStatus } from './TaskScoreStatus'
import { Milestone } from '@/hooks/useScenarios'

jest.mock('@/context/ToastContext', () => ({
  useToastContext: () => ({ success: jest.fn(), warning: jest.fn(), error: jest.fn() }),
}))

jest.mock('@/lib/api', () => ({
  provisioning: {
    submitFlag: jest.fn(),
  },
}))

describe('TaskScoreStatus', () => {
  const mockMilestone: Milestone = {
    id: 1,
    name: 'Host Discovery',
    description: 'Find live hosts',
    points: 50,
  }

  const mockFlagMilestone: Milestone = {
    id: 5,
    name: 'Capture the Flag (whoami)',
    description: 'Submit flag',
    points: 50,
  }

  it('renders pending auto-score notice when not completed and not flag', () => {
    render(
      <TaskScoreStatus
        milestone={mockMilestone}
        completed={false}
        isFlag={false}
        scenarioId="01"
      />
    )
    expect(
      screen.getByText('The range is watching your session — this step scores automatically.')
    ).toBeTruthy()
    expect(screen.queryByText(/Milestone scored/)).toBeNull()
  })

  it('renders scored status when completed is true', () => {
    render(
      <TaskScoreStatus
        milestone={mockMilestone}
        completed={true}
        isFlag={false}
        scenarioId="01"
      />
    )
    expect(screen.getByText('✓ Milestone scored · +50 pts')).toBeTruthy()
  })

  it('renders FlagSubmission when milestone is a flag and not completed', () => {
    render(
      <TaskScoreStatus
        milestone={mockFlagMilestone}
        completed={false}
        isFlag={true}
        scenarioId="01"
      />
    )
    expect(
      screen.getByText('This is the one step you submit yourself.')
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: /Submit/i })).toBeTruthy()
  })

  it('renders scored notice for flag milestone once completed', () => {
    render(
      <TaskScoreStatus
        milestone={mockFlagMilestone}
        completed={true}
        isFlag={true}
        scenarioId="01"
      />
    )
    expect(screen.getByText('✓ Milestone scored · +50 pts')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Submit/i })).toBeNull()
  })

  it('renders DVWA-specific watching message for scenario 06 when pending', () => {
    render(
      <TaskScoreStatus
        milestone={mockMilestone}
        completed={false}
        isFlag={false}
        scenarioId="06"
        surface="dvwa"
      />
    )
    expect(
      screen.getByText("The portal is watching DVWA's reply — this step scores automatically once it sees the result")
    ).toBeTruthy()
  })

  it('renders FlagSubmission with brave-otter placeholder for scenario 06 flag task', () => {
    render(
      <TaskScoreStatus
        milestone={mockFlagMilestone}
        completed={false}
        isFlag={true}
        scenarioId="06"
      />
    )
    expect(
      screen.getByPlaceholderText('e.g. brave-otter-7421')
    ).toBeTruthy()
  })

  it('renders expired status when disabled is true and task is incomplete', () => {
    render(
      <TaskScoreStatus
        milestone={mockMilestone}
        completed={false}
        isFlag={false}
        scenarioId="01"
        disabled={true}
      />
    )
    expect(screen.getByText('Lab session expired. Scoring is unavailable.')).toBeTruthy()
    expect(screen.queryByText(/The range is watching your session/i)).toBeNull()
  })

  it('renders expired status when disabled is true and flag task is incomplete', () => {
    render(
      <TaskScoreStatus
        milestone={mockFlagMilestone}
        completed={false}
        isFlag={true}
        scenarioId="01"
        disabled={true}
      />
    )
    expect(screen.getByText('Lab session expired. Scoring is unavailable.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Submit/i })).toBeNull()
  })

  it('retains scored badge when disabled is true and task is completed', () => {
    render(
      <TaskScoreStatus
        milestone={mockMilestone}
        completed={true}
        isFlag={false}
        scenarioId="01"
        disabled={true}
      />
    )
    expect(screen.getByText('✓ Milestone scored · +50 pts')).toBeTruthy()
  })
})
