/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { fireEvent, render, screen } from "@testing-library/react"
import { TriagedAlerts } from "./TriagedAlerts"
import type { SiemAlert } from "@/lib/api"

function alert(rule_id: string, rule_description: string, timestamp: string): SiemAlert {
  return { timestamp, agent_id: "012", agent_name: "pod-alice-meta", rule_id, rule_description, rule_level: 5 }
}

const ALERTS = [
  ...Array.from({ length: 30 }, (_, i) =>
    alert("19007", "CIS: Ensure permissions on /etc/shadow", `2026-09-30T03:37:${String(i).padStart(2, "0")}.000+0000`)
  ),
  alert("5710", "sshd: attempt to login using a non-existent user", "2026-09-30T03:45:10.000+0000"),
]

it("shows the scenario's rule and hides the start-up scan noise by default", () => {
  render(<TriagedAlerts alerts={ALERTS} totalCount={31} scenarioId="09" />)

  expect(screen.getByTestId("triage-summary")).toHaveTextContent("1 expected for this scenario")
  expect(screen.getByTestId("triage-summary")).toHaveTextContent("30 background (hidden)")
  expect(screen.getByText("sshd: attempt to login using a non-existent user")).toBeInTheDocument()
  expect(screen.queryByText("CIS: Ensure permissions on /etc/shadow")).not.toBeInTheDocument()

  fireEvent.click(screen.getByRole("button", { name: "Show background" }))
  expect(screen.getByText("CIS: Ensure permissions on /etc/shadow")).toBeInTheDocument()
  expect(screen.getByText("30")).toBeInTheDocument() // one grouped row, not 30
})

it("expands a rule to list each occurrence", () => {
  render(<TriagedAlerts alerts={ALERTS} totalCount={31} scenarioId="09" />)
  fireEvent.click(screen.getByText("sshd: attempt to login using a non-existent user"))
  expect(screen.getByText(/· pod-alice-meta/)).toBeInTheDocument()
})

it("says so when only background fired", () => {
  render(<TriagedAlerts alerts={ALERTS.slice(0, 30)} totalCount={30} scenarioId="01" />)
  expect(screen.getByText(/Only background alerts/)).toBeInTheDocument()
})

it("can switch to every raw alert", () => {
  render(<TriagedAlerts alerts={ALERTS} totalCount={31} scenarioId="09" />)
  fireEvent.click(screen.getByRole("button", { name: "Every alert" }))
  expect(screen.getByTestId("alert-history-count")).toHaveTextContent("31 alerts")
})
