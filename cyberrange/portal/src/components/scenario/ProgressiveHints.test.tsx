/** @jest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { ProgressiveHints } from './ProgressiveHints'
import { hintsForTask } from '@/lib/scenarioHints'

describe('scenarioHints data', () => {
  it('provides hints for every scored task, nudge before command', () => {
    // All scored tasks across the four scenarios, including flag and prep tasks.
    const cases: Array<[string, number]> = [
      ['01', 1], ['01', 2], ['01', 3], ['01', 4], ['01', 5],
      ['06', 1], ['06', 2], ['06', 3], ['06', 4], ['06', 5],
      ['09', 0], ['09', 1], ['09', 2], ['09', 3], ['11', 1], ['11', 2], ['11', 3],
    ]
    for (const [sid, mid] of cases) {
      const hints = hintsForTask(sid, mid)
      expect(hints.length).toBeGreaterThanOrEqual(2)
      expect(["command", "instruction"]).toContain(hints[1].kind)
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

  it('keeps the variable warning literal while substituting the command', () => {
    render(<ProgressiveHints scenarioId="01" milestoneId={4} podId={1} />)
    fireEvent.click(screen.getByRole('button', { name: /Show a hint/i }))
    fireEvent.click(screen.getByRole('button', { name: /exact step/i }))
    expect(screen.getByText(/msfconsole does not expand/)).toHaveTextContent('msfconsole does not expand $TARGET_META.')
    expect(screen.getByText(/set RHOSTS 10\.0\.51\.20/)).toBeInTheDocument()
  })

  it.each<[string, string, number]>([
    ['milestone', '01', 2], ['scenario', '06', 1], ['unknown task', '99', 1],
  ])('hides hints when switching %s and returning', (_label, scenarioId, milestoneId) => {
    const { rerender, container } = render(<ProgressiveHints scenarioId="01" milestoneId={1} />)
    fireEvent.click(screen.getByRole('button', { name: /Show a hint/i }))
    fireEvent.click(screen.getByRole('button', { name: /exact step/i }))
    rerender(<ProgressiveHints scenarioId={scenarioId} milestoneId={milestoneId} />)
    expect(container.querySelector('li')).toBeNull()
    expect(screen.queryByRole('button', { name: /Copy command/i })).not.toBeInTheDocument()
    rerender(<ProgressiveHints scenarioId="01" milestoneId={1} />)
    expect(container.querySelector('li')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Show a hint/i }))
    expect(screen.getByText(/Which Nmap flag/i)).toBeInTheDocument()
    expect(screen.queryByText('nmap -sn $TARGET_SUBNET')).not.toBeInTheDocument()
  })

  it('reveals a concrete browser step after the DVWA flag nudge', () => {
    render(<ProgressiveHints scenarioId="06" milestoneId={5} podId={1} />)
    expect(screen.queryByText(/After running the reflected XSS/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Show a hint/i }))
    expect(screen.queryByText(/After running the reflected XSS/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /exact step/i }))
    expect(screen.getByText('Exact step')).toBeInTheDocument()
    expect(screen.getByText(/After running the reflected XSS/)).toHaveTextContent('Copy the displayed code into the flag field in Status and submit it.')
    expect(screen.queryByRole('button', { name: /Copy command/i })).not.toBeInTheDocument()
  })

  it('renders nothing when a task has no hints', () => {
    const { container } = render(<ProgressiveHints scenarioId="99" milestoneId={1} />)
    expect(container).toBeEmptyDOMElement()
  })
})
