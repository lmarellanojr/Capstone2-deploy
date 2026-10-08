/** @jest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom'
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

  it('renders inline `code` and **bold** marks instead of raw markers', () => {
    render(<TerminalSideCue taskId={1} cueText="Run `grep`; **empty** means success" />)
    expect(screen.getByText('grep').tagName).toBe('CODE')
    expect(screen.getByText('empty').tagName).toBe('STRONG')
    expect(screen.queryByText(/`|\*\*/)).toBeNull()
  })

  it('uses the warning style when variant is warning', () => {
    render(<TerminalSideCue taskId={2} cueText="Empty output = success" variant="warning" />)
    const cue = screen.getByRole('complementary', { name: 'Terminal warning' })
    expect(cue).toHaveAttribute('data-variant', 'warning')
  })

  it('defaults to the info style', () => {
    render(<TerminalSideCue taskId={1} cueText="All work is on meta" />)
    expect(screen.getByRole('complementary', { name: 'Terminal tip' })).toHaveAttribute('data-variant', 'info')
  })
})
