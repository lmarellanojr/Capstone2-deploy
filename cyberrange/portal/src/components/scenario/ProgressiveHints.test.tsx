/** @jest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { ProgressiveHints } from './ProgressiveHints'
import { hintsForTask } from '@/lib/scenarioHints'

describe('scenarioHints data', () => {
  it('provides hints for every scored task, nudge before command', () => {
    // Representative scored tasks across the four scenarios.
    const cases: Array<[string, number]> = [
      ['01', 1], ['01', 4], ['06', 1], ['06', 3], ['09', 0], ['09', 2], ['11', 2], ['11', 3],
    ]
    for (const [sid, mid] of cases) {
      const hints = hintsForTask(sid, mid)
      expect(hints.length).toBeGreaterThan(0)
      expect(hints[0].kind).toBe('nudge')
      for (const h of hints) expect(h.text.trim().length).toBeGreaterThan(0)
    }
  })

  it('returns an empty list for an unknown task', () => {
    expect(hintsForTask('99', 1)).toEqual([])
  })
})

describe('ProgressiveHints', () => {
  it('reveals nothing until asked, then one hint at a time', () => {
    render(<ProgressiveHints scenarioId="01" milestoneId={1} />)
    // Nudge text hidden initially.
    expect(screen.queryByText(/Which Nmap flag/i)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Show a hint/i }))
    expect(screen.getByText(/Which Nmap flag/i)).toBeInTheDocument()
    // Exact command not shown yet.
    expect(screen.queryByText('nmap -sn $TARGET_SUBNET')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /exact step/i }))
    expect(screen.getByText('nmap -sn $TARGET_SUBNET')).toBeInTheDocument()
  })

  it('substitutes this pod\'s address into command hints', () => {
    render(<ProgressiveHints scenarioId="01" milestoneId={2} podId={1} />)
    fireEvent.click(screen.getByRole('button', { name: /Show a hint/i })) // nudge
    fireEvent.click(screen.getByRole('button', { name: /exact step/i })) // command
    // podId 1 → meta 10.0.51.20
    expect(screen.getByText('nmap -p 21,22,80,8180 10.0.51.20')).toBeInTheDocument()
  })

  it('renders nothing when a task has no hints', () => {
    const { container } = render(<ProgressiveHints scenarioId="99" milestoneId={1} />)
    expect(container).toBeEmptyDOMElement()
  })
})
