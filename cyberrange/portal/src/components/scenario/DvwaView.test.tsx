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
  vmid_dvwa: 101,
  connection_id: null,
  wazuh_agent_id: null,
  scenario_id: '06',
  created_at: null,
  last_heartbeat: null,
  ttl_hours: 1,
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

  it('renders the card header with Security: Low indicator and Open in new tab button', () => {
    render(<DvwaView pod={mockPod} scenario={scen2} />)
    const header = screen.getByTestId('lab-dvwa-card-header')
    expect(header).toHaveTextContent(/SQL Injection \(DVWA\)/i)
    expect(header).toHaveTextContent(/Security:\s*Low/i)
    expect(screen.getByRole('button', { name: /Open in new tab/i })).toBeInTheDocument()
  })

  it('renders the trimmed module nav strip with exactly the 5 allowed modules', () => {
    render(<DvwaView pod={mockPod} scenario={scen2} />)
    const nav = screen.getByTestId('dvwa-module-nav')
    const buttons = nav.querySelectorAll('button')
    expect(buttons).toHaveLength(5)

    const expectedLabels = ['Home', 'SQL Injection', 'XSS (Reflected)', 'DVWA Security', 'Login']
    expectedLabels.forEach((label) => {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    })
  })

  it('updates the iframe src when a module nav button is clicked', () => {
    render(<DvwaView pod={mockPod} scenario={scen2} />)
    let iframe = screen.getByTitle('DVWA - Damn Vulnerable Web Application') as HTMLIFrameElement
    expect(iframe.src).toContain('/lab/dvwa/index.php')

    const sqliBtn = screen.getByRole('button', { name: 'SQL Injection' })
    fireEvent.click(sqliBtn)
    iframe = screen.getByTitle('DVWA - Damn Vulnerable Web Application') as HTMLIFrameElement
    expect(iframe.src).toContain('/lab/dvwa/vulnerabilities/sqli/')

    const xssBtn = screen.getByRole('button', { name: 'XSS (Reflected)' })
    fireEvent.click(xssBtn)
    iframe = screen.getByTitle('DVWA - Damn Vulnerable Web Application') as HTMLIFrameElement
    expect(iframe.src).toContain('/lab/dvwa/vulnerabilities/xss_r/')
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
})
