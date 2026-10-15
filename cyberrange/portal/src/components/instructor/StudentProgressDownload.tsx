"use client"

import { useState } from "react"
import { Download } from "lucide-react"
import { Button } from "@/components/ui"
import { instructor, type InstructorMilestone, type ReviewCase, type SiemAlert } from "@/lib/api"
import { downloadCsv, saveBlob } from "@/lib/csvExport"
import {
  ALERT_CSV_HEADERS,
  alertCsvRows,
  buildStudentProgressCsv,
} from "@/lib/studentProgressCsv"

interface StudentProgressDownloadProps {
  studentId: string
  milestones: InstructorMilestone[]
  reviews: ReviewCase[]
  /** When set, also try to append the running lab's current alerts. */
  activePodId?: number | null
}

/**
 * Download this student's milestone scores, review scores, and (when available)
 * the live SIEM alert rows as one CSV for grading notes.
 */
export function StudentProgressDownload({
  studentId,
  milestones,
  reviews,
  activePodId,
}: StudentProgressDownloadProps) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const run = async () => {
    setBusy(true)
    setNote(null)
    let alerts: SiemAlert[] | undefined
    let alertsLabel: string | undefined
    if (activePodId != null) {
      try {
        const data = await instructor.getPodAlerts(activePodId, { limit: 200 })
        if (!data.error) {
          alerts = data.alerts || []
          alertsLabel = `live pod ${activePodId}`
        }
      } catch {
        setNote("Scores downloaded; live alerts were unavailable.")
      }
    }
    const csv = buildStudentProgressCsv({
      studentId,
      milestones,
      reviews,
      alerts,
      alertsLabel,
    })
    const name = `student_${studentId}_scores_and_logs.csv`
    saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), name)
    if (!note) {
      setNote(
        alerts
          ? `Downloaded ${name} (milestones, reviews, ${alerts.length} live alerts).`
          : `Downloaded ${name} (milestones and reviews).`,
      )
    }
    setBusy(false)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => void run()}
        disabled={busy || (milestones.length === 0 && reviews.length === 0)}
        aria-label="Download scores and logs as CSV"
      >
        <Download size={14} className="mr-1.5" aria-hidden="true" />
        {busy ? "Preparing…" : "Download scores & logs (CSV)"}
      </Button>
      {note && <span className="text-xs text-text-muted">{note}</span>}
    </div>
  )
}

/** Download only the currently visible (filtered) alert rows. */
export function AlertRowsDownload({
  studentId,
  alerts,
  label,
}: {
  studentId: string
  alerts: SiemAlert[]
  label: string
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="secondary"
      disabled={alerts.length === 0}
      onClick={() =>
        downloadCsv(
          `student_${studentId}_${label}_alerts.csv`,
          ALERT_CSV_HEADERS,
          alertCsvRows(alerts),
        )
      }
      aria-label={`Download ${alerts.length} filtered alerts as CSV`}
    >
      <Download size={14} className="mr-1.5" aria-hidden="true" />
      Download {alerts.length} alert{alerts.length === 1 ? "" : "s"}
    </Button>
  )
}
