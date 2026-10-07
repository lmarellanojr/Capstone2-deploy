/** @jest-environment jsdom */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { TerminalSideCue } from './TerminalSideCue'

describe('TerminalSideCue', () => {
  it('renders cue text when provided', () => {
    render(
      <TerminalSideCue
        taskId={4}
        cueText="After shell, meterpreter prompt becomes plain $"
      />
    )
    expect(
      screen.getByText('After shell, meterpreter prompt becomes plain $')
    ).toBeTruthy()
  })

  it('dismisses when dismiss button is clicked', () => {
    render(
      <TerminalSideCue
        taskId={4}
        cueText="After shell, meterpreter prompt becomes plain $"
      />
    )
    const dismissBtn = screen.getByRole('button', { name: /Dismiss hint/i })
    fireEvent.click(dismissBtn)

    expect(
      screen.queryByText('After shell, meterpreter prompt becomes plain $')
    ).toBeNull()
  })

  it('renders nothing when cueText is undefined', () => {
    const { container } = render(<TerminalSideCue taskId={1} cueText={undefined} />)
    expect(container.firstChild).toBeNull()
  })
})
