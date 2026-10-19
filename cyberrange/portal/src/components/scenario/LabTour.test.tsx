/** @jest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { LabTour, UNPLACED_STYLE, labTourSteps, placeCard, visibleBox } from './LabTour'

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

  it('places against the visible slice of a pane partly scrolled off screen (phone)', () => {
    const narrow = { width: 390, height: 700 }
    // Stacked lab pane: starts 400px down and runs far below the fold.
    const visible = visibleBox({ top: 400, left: 16, width: 358, height: 900 }, narrow)!
    expect(visible).toEqual({ top: 400, left: 16, width: 358, height: 300 })
    const pos = placeCard(visible, card, narrow)
    expect(overlaps({ ...pos, ...card }, visible)).toBe(false)
  })

  it('reports nothing visible for an anchor entirely off screen', () => {
    expect(visibleBox({ top: 900, left: 0, width: 100, height: 100 }, viewport)).toBeNull()
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
    expect(labTourSteps('dvwa')[1].title).toMatch(/DVWA is already signed in/)
    expect(labTourSteps('terminal')[1].title).toMatch(/already connected/)
  })

  it('calls the first stop the current task, since the tour also runs on a resumed lab', () => {
    expect(labTourSteps('terminal')[0].title).toBe('Your current task is here')
  })

  it('tells DVWA students they are signed in at Low, with the login only as a fallback', () => {
    render(<>{labTourSteps('dvwa')[1].body}</>)
    expect(document.body.textContent).toMatch(/signs you in with DVWA Security set to Low/)
    expect(document.body.textContent).toMatch(/Only if DVWA shows its login page: use admin \/ password/)
    expect(document.body.textContent).not.toMatch(/then set DVWA Security/)
  })
})

describe('unplaced card', () => {
  // Real browsers refuse focus inside visibility:hidden / display:none, and the
  // heading is focused before the first measure lands. jsdom can't show that,
  // so pin the style instead.
  it('stays focusable while it is being placed', () => {
    expect(UNPLACED_STYLE).toEqual({ opacity: 0, pointerEvents: 'none' })
    expect(UNPLACED_STYLE).not.toHaveProperty('visibility')
    expect(UNPLACED_STYLE).not.toHaveProperty('display')
  })
})

describe('LabTour', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    for (const t of ['task-panel', 'lab-surface', 'task-status', 'lab-help']) {
      const el = document.createElement('div')
      el.setAttribute('data-tour', t)
      // jsdom lays nothing out; give each anchor an on-screen box.
      el.getBoundingClientRect = () => ({ top: 100, left: 40, width: 200, height: 40 }) as DOMRect
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

  it('can be dismissed with the close button or Escape from inside the card', () => {
    const onClose = jest.fn()
    render(<LabTour open onClose={onClose} surface="dvwa" />)
    fireEvent.click(screen.getByRole('button', { name: /Close walkthrough/i }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Next' }), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('ignores Escape meant for an open dialog or typed outside the card (e.g. the terminal)', () => {
    const onClose = jest.fn()
    const terminal = document.createElement('textarea')
    document.body.appendChild(terminal)
    render(<LabTour open onClose={onClose} surface="terminal" />)

    fireEvent.keyDown(terminal, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()

    const modal = document.createElement('div')
    modal.setAttribute('aria-modal', 'true')
    document.body.appendChild(modal)
    fireEvent.keyDown(screen.getByRole('button', { name: 'Next' }), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('leaves focus in the terminal on auto-start and restores it on close', () => {
    const terminal = document.createElement('textarea')
    document.body.appendChild(terminal)
    terminal.focus()

    const { rerender } = render(<LabTour open onClose={jest.fn()} surface="terminal" focusOnOpen={false} />)
    expect(document.activeElement).toBe(terminal)

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /already connected/i }))

    rerender(<LabTour open={false} onClose={jest.fn()} surface="terminal" focusOnOpen={false} />)
    expect(document.activeElement).toBe(terminal)
  })

  it('measures at most once per frame while the page scrolls', () => {
    jest.useFakeTimers()
    try {
      render(<LabTour open onClose={jest.fn()} surface="terminal" />)
      const anchor = document.querySelector('[data-tour="task-panel"]') as HTMLElement
      const spy = jest.spyOn(anchor, 'getBoundingClientRect')
      for (let i = 0; i < 20; i++) fireEvent.scroll(window)
      expect(spy).not.toHaveBeenCalled()
      act(() => {
        jest.advanceTimersByTime(20)
      })
      expect(spy).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('focuses the card heading when opened from the ? button', () => {
    render(<LabTour open onClose={jest.fn()} surface="terminal" />)
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /current task/i }))
  })

  it('still shows the card (without a ring) if an anchor is missing', () => {
    document.body.innerHTML = ''
    render(<LabTour open onClose={jest.fn()} surface="terminal" />)
    expect(screen.getByTestId('lab-tour-card')).toBeInTheDocument()
    expect(screen.queryByTestId('lab-tour-ring')).toBeNull()
  })
})
