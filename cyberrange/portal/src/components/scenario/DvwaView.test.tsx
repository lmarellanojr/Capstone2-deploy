/** @jest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { DvwaView, DVWA_MODULE_NAV } from './DvwaView'
import { SCENARIOS } from '@/hooks/useScenarios'
import { Pod } from '@/lib/api'

const mockPod: Pod = {
  pod_id: 1,
  student_id: 'student',
  status: 'ACTIVE',
  vmid_kali: null,
  vmid_meta: null,
  vmid_dvwa: 'pod-student-dvwa',
  connection_id: null,
  wazuh_agent_id: null,
  scenario_id: '06',
  created_at: null,
  last_heartbeat: null,
  ttl_minutes: 60,
  remaining_seconds: 300,
  expires_at: null,
  ttl_expired: false,
}

describe('DvwaView presentation component', () => {
  const scen2 = SCENARIOS.find((s) => s.id === '06')!

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders container with min-w-0 and min-h-0 for responsive grid safety', () => {
    render(<DvwaView pod={mockPod} scenario={scen2} />)
    const container = screen.getByTestId('lab-dvwa-container')
    expect(container).toHaveClass('min-w-0')
    expect(container).toHaveClass('min-h-0')
    expect(container).toHaveClass('h-full')
  })

  it('renders the card header with Required: Security Low indicator and Open in new tab button', () => {
    render(<DvwaView pod={mockPod} scenario={scen2} />)
    const header = screen.getByTestId('lab-dvwa-card-header')
    expect(header).toHaveTextContent(/SQL Injection \(DVWA\)/i)
    expect(header).toHaveTextContent(/Required:\s*Security Low/i)
    expect(screen.getByRole('button', { name: /Open in new tab/i })).toBeInTheDocument()
  })

  it('renders the trimmed module nav strip with exactly the 5 allowed modules', () => {
    render(<DvwaView pod={mockPod} scenario={scen2} />)
    const nav = screen.getByTestId('dvwa-module-nav')
    const buttons = nav.querySelectorAll('button')
    expect(buttons).toHaveLength(5)

    const expectedLabels = ['Home', 'SQL Injection', 'XSS (Reflected)', 'DVWA Security', 'Login']
    expectedLabels.forEach((label) => {
      expect(screen.getByRole('button', { name: (content) => content.includes(label) })).toBeInTheDocument()
    })
  })

  it('opens vulnerable modules in new tab and renders external module card', () => {
    const originalOpen = window.open
    window.open = jest.fn()

    render(<DvwaView pod={mockPod} scenario={scen2} />)
    const sqliBtn = screen.getByRole('button', { name: /SQL Injection/i })
    fireEvent.click(sqliBtn)

    expect(window.open).toHaveBeenCalledWith(
      '/lab/dvwa/vulnerabilities/sqli/',
      '_blank',
      'noopener,noreferrer'
    )
    expect(screen.getByTestId('dvwa-external-module-card')).toBeInTheDocument()
    expect(screen.getByText(/SQL Injection \(New Tab\)/i)).toBeInTheDocument()

    // Returning to Home remounts the embedded iframe
    const returnHomeBtn = screen.getByRole('button', { name: /Return to Home/i })
    fireEvent.click(returnHomeBtn)
    expect(screen.queryByTestId('dvwa-external-module-card')).not.toBeInTheDocument()
    const iframe = screen.getByTitle('DVWA - Damn Vulnerable Web Application') as HTMLIFrameElement
    expect(iframe.src).toContain('/lab/dvwa/index.php')

    window.open = originalOpen
  })

  it('switches to external module card when iframe loads a sandboxed page throwing cross-origin security error', () => {
    const originalOpen = window.open
    window.open = jest.fn()

    render(<DvwaView pod={mockPod} scenario={scen2} currentTaskId={1} />)
    const iframe = screen.getByTitle('DVWA - Damn Vulnerable Web Application') as HTMLIFrameElement

    // Simulate cross-origin / sandboxed DOMException on location access
    Object.defineProperty(iframe, 'contentWindow', {
      configurable: true,
      get: () => ({
        get location() {
          throw new DOMException('Blocked a frame with origin "..." from accessing a cross-origin frame.', 'SecurityError')
        },
      }),
    })

    fireEvent.load(iframe)

    expect(screen.getByTestId('dvwa-external-module-card')).toBeInTheDocument()
    expect(screen.getByText(/Vulnerable Module \(New Tab\)/i)).toBeInTheDocument()
    const reopenBtn = screen.getByRole('button', { name: /Reopen Module/i })
    expect(reopenBtn).toBeInTheDocument()

    fireEvent.click(reopenBtn)
    expect(window.open).toHaveBeenCalledWith(
      '/lab/dvwa/vulnerabilities/sqli/',
      '_blank',
      'noopener,noreferrer'
    )

    window.open = originalOpen
  })

  it('updates the iframe src when an embedded module nav button is clicked', () => {
    render(<DvwaView pod={mockPod} scenario={scen2} />)
    let iframe = screen.getByTitle('DVWA - Damn Vulnerable Web Application') as HTMLIFrameElement
    expect(iframe.src).toContain('/lab/dvwa/index.php')

    const secBtn = screen.getByRole('button', { name: 'DVWA Security' })
    fireEvent.click(secBtn)
    iframe = screen.getByTitle('DVWA - Damn Vulnerable Web Application') as HTMLIFrameElement
    expect(iframe.src).toContain('/lab/dvwa/security.php')
  })

  it('calls window.open with noopener and noreferrer when Open in new tab is clicked', () => {
    const originalOpen = window.open
    window.open = jest.fn()

    render(<DvwaView pod={mockPod} scenario={scen2} />)
    const openBtn = screen.getByRole('button', { name: /Open in new tab/i })
    fireEvent.click(openBtn)

    expect(window.open).toHaveBeenCalledWith(
      '/lab/dvwa/index.php',
      '_blank',
      'noopener,noreferrer'
    )

    window.open = originalOpen
  })

  it('renders the floating side cue when provided', () => {
    render(
      <DvwaView
        pod={mockPod}
        scenario={scen2}
        currentTaskId={1}
        currentTaskCue="⚠ Set DVWA Security to Low first — higher levels block these payloads and nothing will score."
      />
    )
    expect(screen.getByText(/Set DVWA Security to Low first/i)).toBeInTheDocument()
  })

  it('displays the target IP computed from pod_id in the card header', () => {
    render(<DvwaView pod={mockPod} scenario={scen2} />)
    expect(screen.getByText(/Target:\s*10\.0\.51\.30/i)).toBeInTheDocument()
  })

  it('renders the TTL grace warning banner when ttlGrace is true and expired is false', () => {
    render(<DvwaView pod={mockPod} scenario={scen2} ttlGrace={true} expired={false} />)
    expect(
      screen.getByText(/Time limit reached\. This lab will close within about 10 minutes\./i)
    ).toBeInTheDocument()
  })

  it('renders session shutting down overlay and does not render iframe when expired is true', () => {
    render(<DvwaView pod={mockPod} scenario={scen2} expired={true} />)
    expect(screen.getByText(/Session shutting down/i)).toBeInTheDocument()
    expect(
      screen.getByText(/This lab session is shutting down\. Your progress is saved\./i)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Back to dashboard/i })).toBeInTheDocument()
    expect(screen.queryByTitle('DVWA - Damn Vulnerable Web Application')).not.toBeInTheDocument()
  })

  it('renders restart button in shutdown overlay when canRestart and onRestart are provided', () => {
    const handleRestart = jest.fn()
    render(
      <DvwaView
        pod={mockPod}
        scenario={scen2}
        expired={true}
        canRestart={true}
        onRestart={handleRestart}
      />
    )
    const restartBtn = screen.getByRole('button', { name: /Start new session/i })
    expect(restartBtn).toBeInTheDocument()
    fireEvent.click(restartBtn)
    expect(handleRestart).toHaveBeenCalledTimes(1)
  })

  it('gates iframe and shows provisioning status when pod is not ACTIVE', () => {
    const provisioningPod: Pod = {
      ...mockPod,
      status: 'PROVISIONING',
    }
    render(<DvwaView pod={provisioningPod} scenario={scen2} />)
    expect(screen.getByTestId('dvwa-inactive-status')).toHaveTextContent(
      /Lab environment is provisioning\.\.\./i
    )
    expect(screen.queryByTitle('DVWA - Damn Vulnerable Web Application')).not.toBeInTheDocument()
  })
})

