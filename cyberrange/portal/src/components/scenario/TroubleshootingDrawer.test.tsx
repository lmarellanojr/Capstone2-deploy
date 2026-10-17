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

  it('shows the Reset-score warning and score-not-updated item for every surface', () => {
    render(<TroubleshootingDrawer isOpen onClose={() => {}} surface="dvwa" />)
    expect(screen.getByText(/"Reset score" — what it does/)).toBeInTheDocument()
    expect(screen.getByText(/score did not update/i)).toBeInTheDocument()
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
