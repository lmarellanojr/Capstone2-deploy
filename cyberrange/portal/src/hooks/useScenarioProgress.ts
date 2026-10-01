'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { provisioning } from '@/lib/api'
import { SCENARIOS } from '@/hooks/useScenarios'
import { earnedByScenario } from '@/lib/scenarioProgress'

/** Points earned per catalog scenario ("01", "06", ...), from GET /progress.
 *  null until loaded; {} if the request fails, so the UI simply shows every
 *  lab as not started rather than an error. */
export function useScenarioProgress(): Record<string, number> | null {
  const { status } = useSession()
  const [earned, setEarned] = useState<Record<string, number> | null>(null)

  useEffect(() => {
    if (status !== 'authenticated') return
    let active = true
    provisioning
      .getProgress()
      .then((data) => {
        if (active) setEarned(earnedByScenario(data.milestones, SCENARIOS))
      })
      .catch(() => {
        if (active) setEarned({})
      })
    return () => {
      active = false
    }
  }, [status])

  return earned
}
