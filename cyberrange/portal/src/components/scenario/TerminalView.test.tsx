/** @jest-environment jsdom */
import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { TerminalView } from './TerminalView'
import { SCENARIOS } from '@/hooks/useScenarios'
import { Pod } from '@/lib/api'

const mockSuccess = jest.fn()
const mockWarning = jest.fn()
const mockToastError = jest.fn()

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('next-auth/react', () => ({ useSession: () => ({ data: { accessToken: 'test-token' } }) }))
jest.mock('@/context/ToastContext', () => ({
  useToastContext: () => ({ success: mockSuccess, warning: mockWarning, error: mockToastError }),
}))
jest.mock('@/lib/api', () => ({
  provisioning: {
    getLabUrls: jest.fn().mockResolvedValue({}),
  },
}))
jest.mock('@/components/terminal/XtermView', () => ({ XtermView: () => <div data-testid="xterm" /> }))
jest.mock('@/components/terminal/terminalSessionManager', () => ({
  destroySession: jest.fn(),
  sessionKey: jest.fn(),
  focusSession: jest.fn(),
}))
jest.mock('@/components/scenario/GuideExtraModal', () => ({ GuideExtraModal: () => null }))
jest.mock('@/components/scenario/SiemAlertViewer', () => ({ SiemAlertViewer: () => <div /> }))
jest.mock('@/components/ui', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <button {...props}>{children}</button>,
  Modal: ({ isOpen, children }: React.PropsWithChildren<{ isOpen: boolean }>) => isOpen ? <div>{children}</div> : null,
  ModalHeader: ({ title }: { title: string }) => <h2>{title}</h2>,
  ModalBody: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  ModalFooter: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
}))

const pod = (podId: number): Pod => ({
  pod_id: podId,
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
})

describe('TerminalView presentation component', () => {
  const scen1 = SCENARIOS.find((s) => s.id === '01')!

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders the terminal card header with active target and tools button', async () => {
    render(<TerminalView pod={pod(1)} scenario={scen1} onEnd={jest.fn()} />)
    const cardHeader = screen.getByTestId('lab-terminal-card-header')
    expect(within(cardHeader).getByRole('heading', { name: 'Kali Linux (CLI)' })).toBeTruthy()
    expect(within(cardHeader).getByRole('button', { name: /Tools/i })).toBeTruthy()
  })

  it('renders the floating side cue when provided', () => {
    render(
      <TerminalView
        pod={pod(1)}
        scenario={scen1}
        currentTaskId={4}
        currentTaskCue="After shell, prompt changes to $"
        onEnd={jest.fn()}
      />
    )
    expect(screen.getByText('After shell, prompt changes to $')).toBeTruthy()
  })

  it('opens and closes Kali explainer modal on demand', async () => {
    render(<TerminalView pod={pod(1)} scenario={scen1} onEnd={jest.fn()} />)
    // Click Kali connection tab to trigger explainer modal
    fireEvent.click(screen.getByRole('button', { name: 'Kali Linux (CLI)' }))
    expect(screen.getAllByRole('heading', { name: 'Kali Linux (CLI)' }).length).toBe(2)
  })
})
