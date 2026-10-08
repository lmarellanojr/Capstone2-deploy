'use client'

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, Check } from 'lucide-react'
import { Milestone } from '@/hooks/useScenarios'

interface ScenarioOutlineProps {
  tasks: Milestone[]
  currentTaskId: number
  completedTaskIds: Set<number>
  onSelectTask: (taskId: number) => void
  /** Display offset for the task badge (SIEM prep uses 0). */
  startNumber?: number
}

export function ScenarioOutline({
  tasks,
  currentTaskId,
  completedTaskIds,
  onSelectTask,
  startNumber = 1,
}: ScenarioOutlineProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const currentIndex = tasks.findIndex((t) => t.id === currentTaskId)
  const currentTask = tasks[currentIndex] ?? tasks[0]
  const isFirst = currentIndex <= 0
  const isLast = currentIndex >= tasks.length - 1
  const handlePrev = useCallback(() => {
    if (!isFirst && currentIndex > 0) {
      onSelectTask(tasks[currentIndex - 1].id)
    }
  }, [isFirst, currentIndex, tasks, onSelectTask])

  const handleNext = useCallback(() => {
    if (!isLast && currentIndex < tasks.length - 1) {
      onSelectTask(tasks[currentIndex + 1].id)
    }
  }, [isLast, currentIndex, tasks, onSelectTask])

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  if (!tasks.length) return null

  return (
    <div ref={containerRef} className="relative inline-flex items-center gap-1 text-sm">
      <button
        type="button"
        onClick={handlePrev}
        disabled={isFirst}
        aria-label="Previous task"
        title="Previous task"
        className="p-1.5 rounded-lg border border-border text-text-muted hover:text-text-main hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition focus-ring"
      >
        <ChevronLeft size={16} aria-hidden="true" />
      </button>

      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-border bg-secondary text-text-main font-medium hover:border-brand/40 transition focus-ring"
      >
        <span className="sr-only">Scenario Outline: </span>
        <span className="font-semibold text-brand">Task {currentIndex + startNumber}</span>
        <span className="text-text-muted hidden sm:inline truncate max-w-[160px]">
          {currentTask?.name}
        </span>
        <ChevronDown
          size={14}
          className={`text-text-muted transition-transform duration-150 ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      <button
        type="button"
        onClick={handleNext}
        disabled={isLast}
        aria-label="Next task"
        title="Next task"
        className="p-1.5 rounded-lg border border-border text-text-muted hover:text-text-main hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition focus-ring"
      >
        <ChevronRight size={16} aria-hidden="true" />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-label="Scenario tasks"
          className="absolute top-full mt-1.5 left-0 z-30 w-72 rounded-xl bg-secondary border border-border shadow-overlay p-1.5 space-y-1"
        >
          {tasks.map((task, idx) => {
            const isScored = !task.unscored && completedTaskIds.has(task.id)
            const isSelected = task.id === currentTaskId

            return (
              <button
                key={task.id}
                role="option"
                aria-selected={isSelected}
                type="button"
                onClick={() => {
                  onSelectTask(task.id)
                  setIsOpen(false)
                  triggerRef.current?.focus()
                }}
                className={`w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-xs transition ${
                  isSelected
                    ? 'bg-muted text-text-main font-semibold'
                    : 'text-text-secondary hover:bg-muted/60 hover:text-text-main'
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold ${
                      isScored
                        ? 'bg-emerald-100 text-emerald-800'
                        : isSelected
                          ? 'bg-brand text-white'
                          : 'bg-muted text-text-muted'
                    }`}
                  >
                    {isScored ? <Check size={12} aria-hidden="true" /> : idx + startNumber}
                  </span>
                  <span className="truncate">{task.name}</span>
                </div>
                <span className="text-text-faint text-[11px] shrink-0 font-mono">
                  {task.unscored ? 'Prep · not scored' : `${task.points} pts`}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
