/** @jest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { PrereqBox } from './PrereqBox'
import { prereqsForScenario } from '@/lib/scenarioPrereqs'
import { SCENARIOS } from '@/hooks/useScenarios'

describe('scenarioPrereqs data', () => {
  it('covers every scenario with non-empty tools and concepts', () => {
    for (const scenario of SCENARIOS) {
      const p = prereqsForScenario(scenario.id)
      expect(p).not.toBeNull()
      expect(p!.intro.trim().length).toBeGreaterThan(0)
      expect(p!.tools.length).toBeGreaterThan(0)
      expect(p!.concepts.length).toBeGreaterThan(0)
      for (const item of [...p!.tools, ...p!.concepts]) {
        expect(item.term.trim().length).toBeGreaterThan(0)
        expect(item.blurb.trim().length).toBeGreaterThan(0)
      }
    }
  })

  it('returns null for an unknown scenario', () => {
    expect(prereqsForScenario('99')).toBeNull()
  })
})

describe('PrereqBox', () => {
  it('shows tools and concepts when open by default', () => {
    render(<PrereqBox scenarioId="06" />)
    expect(screen.getByText(/Before you start/i)).toBeInTheDocument()
    expect(screen.getByText('DVWA')).toBeInTheDocument()
    expect(screen.getByText('UNION SELECT')).toBeInTheDocument()
  })

  it('collapses and expands on click', () => {
    render(<PrereqBox scenarioId="01" defaultOpen={false} />)
    expect(screen.queryByText('Nmap')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    expect(screen.getByText('Nmap')).toBeInTheDocument()
  })

  it('renders nothing for a scenario without prerequisites', () => {
    const { container } = render(<PrereqBox scenarioId="99" />)
    expect(container).toBeEmptyDOMElement()
  })
})
