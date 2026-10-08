'use client'

import { TerminalView, type TerminalViewProps } from './TerminalView'
import { getLabSurface } from '@/hooks/useScenarios'

// Keep host sessions, expiry and dialogs in the existing lab component.
// Metadata selects the surface, independently of the display scenario number.
export function LabSurface(props: Omit<TerminalViewProps, 'surface'>) {
  const surface = getLabSurface(props.scenario)
  return <TerminalView key={`${props.pod.pod_id}:${surface}`} {...props} surface={surface} />
}
