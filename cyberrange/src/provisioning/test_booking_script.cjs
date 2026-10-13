const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const sent = []
let uuid = 0
let lockHeld = false
const triggers = [{ getHandlerFunction: () => "reconcilePendingProvisioning" }]
let failNextEmail = false
class Range {
  constructor(sheet, row, col, rows = 1, cols = 1) { Object.assign(this, { sheet, row, col, rows, cols }) }
  setNumberFormat() { return this }
  setFontWeight() { return this }
  setValues(values) { values.forEach((line, ri) => line.forEach((value, ci) => { this.sheet.cells[this.row - 1 + ri][this.col - 1 + ci] = value })); return this }
  setValue(value) { this.sheet.cells[this.row - 1][this.col - 1] = value; return this }
  getValue() { return this.sheet.cells[this.row - 1]?.[this.col - 1] || "" }
  getDisplayValue() { return String(this.getValue()) }
  getDisplayValues() { return Array.from({ length: this.rows }, (_, ri) => Array.from({ length: this.cols }, (_, ci) => String(this.sheet.cells[this.row - 1 + ri]?.[this.col - 1 + ci] || ""))) }
}
class Sheet {
  constructor() { this.cells = Array.from({ length: 20 }, () => Array(20).fill("")) }
  getLastRow() { let end = 0; this.cells.forEach((row, i) => { if (row.some(v => v !== "")) end = i + 1 }); return end }
  getLastColumn() { return Math.max(0, ...this.cells.map(row => row.reduce((last, value, i) => value !== "" ? i + 1 : last, 0))) }
  getMaxColumns() { return 20 }
  insertColumnsAfter() {}
  appendRow(row) { this.cells[this.getLastRow()] = [...row, ...Array(20 - row.length).fill("")] }
  getRange(r, c, nr = 1, nc = 1) { return new Range(this, r, c, nr, nc) }
  setFrozenRows() {}
}
const sheet = new Sheet()
const lock = {
  waitLock() { if (lockHeld) throw new Error("lock busy"); lockHeld = true },
  releaseLock() { lockHeld = false },
}
const ctx = {
  console, Date, Math, JSON, String, Number, Array, Object, RegExp, encodeURIComponent,
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet, getUrl: () => "https://sheets.google.test/bookings" }) },
  LockService: { getScriptLock: () => lock },
  PropertiesService: { getScriptProperties: () => { throw new Error("booking must not read script secrets") } },
  UrlFetchApp: { fetch: () => { throw new Error("booking must not call domain APIs") } },
  MailApp: { sendEmail: message => {
    if (failNextEmail) { failNextEmail = false; throw new Error("temporary mail failure") }
    sent.push(message)
  } },
  Session: { getEffectiveUser: () => ({ getEmail: () => "organizer@mmdc.mcl.edu.ph" }) },
  Utilities: { getUuid: () => `uuid-${++uuid}`, newBlob: data => data },
  ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: text => ({ text, setMimeType() { return this } }) },
  ScriptApp: {
    getProjectTriggers: () => triggers,
    deleteTrigger: trigger => { const index = triggers.indexOf(trigger); if (index >= 0) triggers.splice(index, 1) },
    newTrigger: handler => ({
      timeBased() { return this },
      everyMinutes(minutes) { this.minutes = minutes; return this },
      create() { const trigger = { getHandlerFunction: () => handler, minutes: this.minutes }; triggers.push(trigger); return trigger },
    }),
  },
}
vm.createContext(ctx)
const source = fs.readFileSync(path.join(__dirname, "..", "..", "booking", "Code.gs"), "utf8")
vm.runInContext(source, ctx)

const event = body => ({ postData: { contents: JSON.stringify(body) } })
failNextEmail = true
const created = JSON.parse(ctx.doPost(event({ action: "book", domainId: "d1", slotId: "2026-10-19_0900-1100", name: "Test Person", email: "tester@mmdc.mcl.edu.ph" })).text)
assert.equal(created.ok, true)
assert.equal(created.domainId, "d1")
assert.equal(Object.hasOwn(created, "accountStatus"), false)
assert.equal(sent.length, 1, "booking confirmation is sent even when the organizer email fails")
assert.equal(sheet.cells[0][15], "Organizer notice sent")
assert.equal(sheet.cells[1][14], "", "booking does not record an automatic account creation result")
assert.equal(sheet.cells[1][15], "", "failed organizer notice remains pending for retry")

const ownerAction = "Admin → Users and create an enabled Student account"
assert.match(sent[0].body, /A domain owner will create your account after booking/)
assert.match(sent[0].body, /separate email with your username and temporary password/)
assert.doesNotMatch(sent[0].body, /credentials were sent|password was emailed/i)
assert.ok(sent[0].htmlBody.includes(ownerAction) === false, "tester message does not ask tester to use the admin page")

const details = ctx.eventDetails_(created.token)
const calendarUrl = new URL(ctx.gcalUrl_({ date: "2026-10-19", start: "09:00", end: "11:00" }, created.token))
assert.match(decodeURIComponent(calendarUrl.searchParams.get("details")), /A domain owner will create your account after booking/)
assert.match(decodeURIComponent(calendarUrl.searchParams.get("details")), /separate email with your username and temporary password/)
assert.doesNotMatch(decodeURIComponent(calendarUrl.searchParams.get("details")), /credentials will be emailed/i)
const ics = ctx.ics_({ date: "2026-10-19", start: "09:00", end: "11:00" }, created.token).replace(/\r\n /g, "")
assert.match(ics, /A domain owner will create your account after booking/)
assert.match(ics, /separate email with your username and temporary password/)
assert.doesNotMatch(ics, /credentials will be emailed/i)
assert.match(details, /A domain owner will create your account after booking/)

ctx.installOrganizerNoticeRetry()
assert.equal(triggers.length, 1, "one-time setup replaces account reconciliation with one email retry trigger")
assert.equal(triggers[0].getHandlerFunction(), "retryPendingOrganizerNotices")
assert.equal(triggers[0].minutes, 5)
ctx.retryPendingOrganizerNotices()
assert.equal(sheet.cells[1][15], "yes", "successful retry marks the organizer notice sent")
assert.equal(sent.length, 2, "retry delivers the previously failed organizer notice")
assert.match(sent[1].body, /Action required/)
assert.match(sent[1].body, /Admin.*Users and create an enabled Student account/)
assert.match(sent[1].body, /temporary password automatically when you create the account/)
assert.doesNotMatch(sent[1].body, /credential email was sent|password was emailed/i)
ctx.retryPendingOrganizerNotices()
assert.equal(sent.length, 2, "sent organizer notices are not duplicated")

const duplicate = JSON.parse(ctx.doPost(event({ action: "book", domainId: "d1", slotId: "2026-10-19_0900-1100", name: "Test Person", email: "tester@mmdc.mcl.edu.ph" })).text)
assert.equal(duplicate.error, "duplicate_time")
const cancelled = JSON.parse(ctx.doPost(event({ action: "cancel", domainId: "d1", slotId: "2026-10-19_0900-1100", token: created.token })).text)
assert.equal(cancelled.ok, true)
assert.equal(sheet.cells[1][12], "cancelled")
assert.match(sent.at(-1).body, /BOOKING CANCELLED/)

assert.doesNotMatch(source, /BOOKING_PROVISION_SECRET|UrlFetchApp\.fetch|reconcilePendingProvisioning\(\)/)

console.log("Apps Script booking, manual account instructions, organizer/tester email, Google Calendar and ICS copy, cancellation, and legacy-trigger cleanup checks passed.")
