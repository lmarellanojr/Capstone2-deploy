'use client'

import { useState } from 'react'
import { Flag } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { provisioning } from '@/lib/api'
import { useToastContext } from '@/context/ToastContext'

interface FlagSubmissionProps {
  /** Catalog scenario id, e.g. "01" or "06". */
  scenarioId: string
  milestoneId: number
  /** Called once the submitted flag is accepted (status PASS). */
  onPass: () => void
  /** Input placeholder; defaults to the FLAG{...} format. */
  placeholder?: string
}

/**
 * Flag-capture input for the "find the flag" final tasks (Scenario 1 & 2).
 * Flow: find the flag -> type it -> Submit -> validate -> award.
 * A correct flag scores immediately; an incorrect one shows a helpful error and
 * never awards points. The backend is idempotent, so resubmitting a correct flag
 * can't double-count, and the input disappears once the task is complete.
 */
export function FlagSubmission({ scenarioId, milestoneId, onPass, placeholder = 'FLAG{...}' }: FlagSubmissionProps) {
  const { success } = useToastContext()
  const [flag, setFlag] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const value = flag.trim()
    if (!value || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await provisioning.submitFlag(parseInt(scenarioId, 10), {
        milestone_id: milestoneId,
        flag: value,
      })
      if (res.status === 'PASS') {
        success('Correct flag — task complete!')
        setFlag('')
        onPass()
      } else {
        setError(res.message || 'That flag is not correct. Check it and try again.')
      }
    } catch {
      setError('Could not submit the flag right now. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="mt-1.5 px-1">
      <label htmlFor={`flag-${scenarioId}-${milestoneId}`} className="block text-xs font-semibold text-text-main mb-1">
        Submit the flag you found
      </label>
      <div className="flex gap-2">
        <input
          id={`flag-${scenarioId}-${milestoneId}`}
          type="text"
          value={flag}
          onChange={(e) => { setFlag(e.target.value); if (error) setError(null) }}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
          className="flex-1 min-w-0 rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm font-mono text-text-main placeholder:text-text-faint focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40"
        />
        <Button type="submit" size="sm" variant="primary" loading={submitting} disabled={!flag.trim()}>
          <Flag size={14} aria-hidden="true" />
          Submit
        </Button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  )
}
