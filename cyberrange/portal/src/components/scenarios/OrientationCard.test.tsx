/** @jest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom'
import { render, screen } from '@testing-library/react'
import { OrientationCard } from './OrientationCard'

describe('OrientationCard', () => {
  it('renders title, badge, and link to /scenario/orientation', () => {
    render(<OrientationCard />)

    expect(screen.getByText('Scenario 0 — Lab Orientation')).toBeTruthy()
    expect(screen.getByText('Start Here')).toBeTruthy()
    expect(screen.getByText('No lab pod required')).toBeTruthy()

    const link = screen.getByRole('link', { name: /Start Orientation/i })
    expect(link).toHaveAttribute('href', '/scenario/orientation')
  })
})
