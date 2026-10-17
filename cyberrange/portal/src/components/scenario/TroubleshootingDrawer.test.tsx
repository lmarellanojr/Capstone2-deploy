/** @jest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { TroubleshootingDrawer } from './TroubleshootingDrawer'

describe('TroubleshootingDrawer', () => {
  it('renders nothing when closed', () => {
    const { container } = render(
      <TroubleshootingDrawer isOpen={false} onClose={() => {}} surface="terminal" />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it.each(['terminal', 'dvwa', 'siem'] as const)('shows accurate shared advice on %s', (surface) => {
    render(<TroubleshootingDrawer isOpen onClose={() => {}} surface={surface} />)
    expect(screen.getByText(/"Reset score"/)).toBeInTheDocument()
    expect(screen.getByText(/score did not update/i)).toBeInTheDocument()
    expect(screen.getByText(/active lab is the right scenario/i)).toBeInTheDocument()
    expect(screen.queryByText(/banner/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Ask an instructor to check this task/i)).not.toBeInTheDocument()
  })

  it.each(['terminal', 'dvwa'] as const)('offers Manual Check only when available on %s', (surface) => {
    render(<TroubleshootingDrawer isOpen onClose={() => {}} surface={surface} />)
    expect(screen.getByText('Manual Check')).toBeInTheDocument()
    expect(screen.getByText(/when available/)).toBeInTheDocument()
    expect(screen.queryByText(/saved files on/)).not.toBeInTheDocument()
    if (surface === 'dvwa') {
      expect(screen.queryByText(/once in the shell/)).not.toBeInTheDocument()
      expect(screen.getByText(/after the browser step/)).toBeInTheDocument()
    }
  })

  it('gives SIEM artifact advice without unavailable Manual Check controls', () => {
    render(<TroubleshootingDrawer isOpen onClose={() => {}} surface="siem" />)
    expect(screen.queryByText(/Manual Check/)).not.toBeInTheDocument()
    expect(screen.getByText(/The checker reads your saved files on/)).toBeInTheDocument()
    expect(screen.getByText('meta')).toBeInTheDocument()
    expect(screen.getByText(/Check the filename, location/)).toBeInTheDocument()
    expect(screen.getByText(/terminal stopped responding/)).toBeInTheDocument()
    expect(screen.queryByText(/DVWA sent me back/)).not.toBeInTheDocument()
  })

  it('closes only on backdrop clicks, not clicks inside the panel', () => {
    const onClose = jest.fn()
    render(<TroubleshootingDrawer isOpen onClose={onClose} surface="terminal" />)
    const panel = screen.getByRole('dialog')
    fireEvent.mouseDown(panel)
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.mouseDown(panel.parentElement!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('traps focus, restores the trigger, and restores body scrolling on close', () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'auto'
    const { rerender, unmount } = render(
      <TroubleshootingDrawer isOpen onClose={() => {}} surface="terminal" />
    )
    try {
      const close = screen.getByRole('button', { name: /Close troubleshooting/i })
      expect(close).toHaveFocus()
      expect(document.body.style.overflow).toBe('hidden')
      for (const shiftKey of [false, true]) {
        const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, cancelable: true, bubbles: true })
        close.dispatchEvent(event)
        expect(event.defaultPrevented).toBe(true)
        expect(close).toHaveFocus()
      }
      rerender(<TroubleshootingDrawer isOpen={false} onClose={() => {}} surface="terminal" />)
      expect(trigger).toHaveFocus()
      expect(document.body.style.overflow).toBe('auto')
    } finally {
      unmount()
      trigger.remove()
      document.body.style.overflow = previousOverflow
    }
  })

  it('filters items to the lab surface', () => {
    const { rerender } = render(
      <TroubleshootingDrawer isOpen onClose={() => {}} surface="dvwa" />
    )
    // DVWA-only item present; terminal-only item absent.
    expect(screen.getByText(/DVWA sent me back to the login page/i)).toBeInTheDocument()
    expect(screen.queryByText(/terminal stopped responding/i)).not.toBeInTheDocument()

    rerender(<TroubleshootingDrawer isOpen onClose={() => {}} surface="terminal" />)
    expect(screen.getByText(/terminal stopped responding/i)).toBeInTheDocument()
    expect(screen.queryByText(/DVWA sent me back to the login page/i)).not.toBeInTheDocument()
  })

  it('closes on the close button and on Escape', () => {
    const onClose = jest.fn()
    render(<TroubleshootingDrawer isOpen onClose={onClose} surface="siem" />)
    fireEvent.click(screen.getByRole('button', { name: /Close troubleshooting/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
