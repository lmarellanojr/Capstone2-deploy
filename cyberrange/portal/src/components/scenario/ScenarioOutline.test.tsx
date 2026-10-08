/** @jest-environment jsdom */
import React from 'react'
import '@testing-library/jest-dom'
import { fireEvent, render, screen } from '@testing-library/react'
import { ScenarioOutline } from './ScenarioOutline'
import { Milestone } from '@/hooks/useScenarios'

describe('ScenarioOutline', () => {
  const mockTasks: Milestone[] = [
    { id: 1, name: 'Task One', description: 'Desc 1', points: 50 },
    { id: 2, name: 'Task Two', description: 'Desc 2', points: 75 },
    { id: 3, name: 'Task Three', description: 'Desc 3', points: 100 },
  ]

  it('disables Prev button on the first task and Next on the last task', () => {
    const onSelect = jest.fn()
    const { rerender } = render(
      <ScenarioOutline
        tasks={mockTasks}
        currentTaskId={1}
        completedTaskIds={new Set()}
        onSelectTask={onSelect}
      />
    )

    const prevBtn = screen.getByRole('button', { name: /Previous task/i })
    const nextBtn = screen.getByRole('button', { name: /Next task/i })

    expect(prevBtn).toBeDisabled()
    expect(nextBtn).not.toBeDisabled()

    fireEvent.click(nextBtn)
    expect(onSelect).toHaveBeenCalledWith(2)

    rerender(
      <ScenarioOutline
        tasks={mockTasks}
        currentTaskId={3}
        completedTaskIds={new Set()}
        onSelectTask={onSelect}
      />
    )

    expect(screen.getByRole('button', { name: /Previous task/i })).not.toBeDisabled()
    expect(screen.getByRole('button', { name: /Next task/i })).toBeDisabled()
  })

  it('opens dropdown, displays tasks with points, and closes on selection', () => {
    const onSelect = jest.fn()
    render(
      <ScenarioOutline
        tasks={mockTasks}
        currentTaskId={1}
        completedTaskIds={new Set([1])}
        onSelectTask={onSelect}
      />
    )

    // Trigger button
    const trigger = screen.getByRole('button', { name: /Task 1/i })
    expect(screen.queryByRole('listbox')).toBeNull()

    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeTruthy()

    // Click Task 2 in the dropdown list
    const option = screen.getByRole('option', { name: /Task Two/i })
    fireEvent.click(option)

    expect(onSelect).toHaveBeenCalledWith(2)
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes dropdown on Escape key', () => {
    render(
      <ScenarioOutline
        tasks={mockTasks}
        currentTaskId={1}
        completedTaskIds={new Set()}
        onSelectTask={jest.fn()}
      />
    )

    const trigger = screen.getByRole('button', { name: /Task 1/i })
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('closes dropdown on outside click', () => {
    render(
      <div>
        <div data-testid="outside">Outside area</div>
        <ScenarioOutline
          tasks={mockTasks}
          currentTaskId={1}
          completedTaskIds={new Set()}
          onSelectTask={jest.fn()}
        />
      </div>
    )

    const trigger = screen.getByRole('button', { name: /Task 1/i })
    fireEvent.click(trigger)
    expect(screen.getByRole('listbox')).toBeTruthy()

    fireEvent.mouseDown(screen.getByTestId('outside'))
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('numbers a prep step as Task 0 and labels it unscored', () => {
    const prepAndTasks: Milestone[] = [
      { id: 0, name: 'Generate the alerts', description: 'Prep', points: 0, unscored: true },
      ...mockTasks,
    ]
    render(
      <ScenarioOutline
        tasks={prepAndTasks}
        currentTaskId={0}
        completedTaskIds={new Set([0])}
        onSelectTask={jest.fn()}
        startNumber={0}
      />
    )

    expect(screen.getByRole('button', { name: /Task 0 Generate the alerts/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Task 0 Generate the alerts/i }))
    expect(screen.getByRole('option', { name: /Generate the alerts/ })).toHaveTextContent('Prep · not scored')
    expect(screen.getByRole('option', { name: /Generate the alerts/ })).not.toHaveTextContent('✓')
  })
})
