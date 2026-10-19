/** @jest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { LabTour, labTourSteps, placeCard } from './LabTour'

const viewport = { width: 1200, height: 800 }
const card = { width: 320, height: 160 }

const overlaps = (
  a: { top: number; left: number; width: number; height: number },
  b: { top: number; left: number; width: number; height: number }
) => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height

describe('placeCard', () => {
  it('puts the card below a small anchor with room beneath it', () => {
    expect(placeCard({ top: 100, left: 40, width: 200, height: 40 }, card, viewport)).toEqual({ top: 152, left: 40 })
  })

  it('goes above when there is no room below', () => {
    const anchor = { top: 740, left: 900, width: 280, height: 40 }
    const pos = placeCard(anchor, card, viewport)
    expect(pos.top).toBe(740 - 12 - 160)
    expect(overlaps({ ...pos, ...card }, anchor)).toBe(false)
  })

  it('goes beside a full-height pane instead of covering it', () => {
    const leftPane = { top: 80, left: 16, width: 580, height: 680 }
    const pos = placeCard(leftPane, card, viewport)
    expect(pos.left).toBe(16 + 580 + 12)
    expect(overlaps({ ...pos, ...card }, leftPane)).toBe(false)

    const rightPane = { top: 80, left: 604, width: 580, height: 680 }
    expect(overlaps({ ...placeCard(rightPane, card, viewport), ...card }, rightPane)).toBe(false)
  })

  it('stays inside a narrow viewport when nothing fits beside the anchor', () => {
    const narrow = { width: 390, height: 700 }
    const pane = { top: 0, left: 16, width: 358, height: 900 }
    const pos = placeCard(pane, card, narrow)
    expect(pos.left).toBeGreaterThanOrEqual(16)
    expect(pos.left + card.width).toBeLessThanOrEqual(390 - 16)
    expect(pos.top).toBeGreaterThanOrEqual(16)
    expect(pos.top + card.height).toBeLessThanOrEqual(700 - 16)
  })
})

describe('labTourSteps', () => {
  it('walks task → lab → status → help, with DVWA login guidance only for DVWA', () => {
    expect(labTourSteps('terminal').map((s) => s.target)).toEqual(['task-panel', 'lab-surface', 'task-status', 'lab-help'])
    expect(labTourSteps('dvwa')[1].title).toMatch(/DVWA/)
    expect(labTourSteps('terminal')[1].title).toMatch(/already connected/)
  })
})

describe('LabTour', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    for (const t of ['task-panel', 'lab-surface', 'task-status', 'lab-help']) {
      const el = document.createElement('div')
      el.setAttribute('data-tour', t)
      document.body.appendChild(el)
    }
  })

  it('renders nothing when closed', () => {
    render(<LabTour open={false} onClose={jest.fn()} surface="terminal" />)
    expect(screen.queryByTestId('lab-tour-card')).toBeNull()
  })

  it('steps through each anchor and closes on the last step', () => {
    const onClose = jest.fn()
    render(<LabTour open onClose={onClose} surface="terminal" />)
    const cardEl = screen.getByTestId('lab-tour-card')
    expect(cardEl).toHaveAttribute('role', 'dialog')
    expect(cardEl).toHaveAttribute('aria-modal', 'false')
    expect(cardEl).toHaveAttribute('data-step-target', 'task-panel')
    expect(screen.getByTestId('lab-tour-ring')).toBeInTheDocument()
    expect(screen.getByText('1 of 4')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(cardEl).toHaveAttribute('data-step-target', 'lab-surface')
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(cardEl).toHaveAttribute('data-step-target', 'task-panel')

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(cardEl).toHaveAttribute('data-step-target', 'lab-help')
    fireEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('can be dismissed with the close button or Escape', () => {
    const onClose = jest.fn()
    render(<LabTour open onClose={onClose} surface="dvwa" />)
    fireEvent.click(screen.getByRole('button', { name: /Close walkthrough/i }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('still shows the card (without a ring) if an anchor is missing', () => {
    document.body.innerHTML = ''
    render(<LabTour open onClose={jest.fn()} surface="terminal" />)
    expect(screen.getByTestId('lab-tour-card')).toBeInTheDocument()
    expect(screen.queryByTestId('lab-tour-ring')).toBeNull()
  })
})
