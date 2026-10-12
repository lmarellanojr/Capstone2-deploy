const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const sent = []
const fetched = []
let uuid = 0
let fetchCode = 200
let fetchBody = { status: "created", credential_email_status: "sent" }
let fetchReplies = []
let fetchHook = null
let failNextMail = false
let lockHeld = false
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
  tryLock() { if (lockHeld) return false; lockHeld = true; return true },
  releaseLock() { lockHeld = false },
}
const ctx = {
  console,
  Date,
  Math,
  JSON,
  String,
  Number,
  Array,
  Object,
  RegExp,
  encodeURIComponent,
  decodeURIComponent,
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: () => sheet, insertSheet: () => sheet, getUrl: () => "https://sheets.google.test/bookings" }) },
  LockService: { getScriptLock: () => lock },
  PropertiesService: { getScriptProperties: () => ({ getProperty: name => name === "BOOKING_PROVISION_SECRET_D1" ? "unit-secret" : null }) },
  UrlFetchApp: { fetch: (url, options) => {
    fetched.push({ url, options })
    const reply = fetchReplies.shift() || { code: fetchCode, body: fetchBody }
    const hook = fetchHook
    fetchHook = null
    if (hook) hook()
    return { getResponseCode: () => reply.code, getContentText: () => JSON.stringify(reply.body) }
  } },
  MailApp: { sendEmail: message => {
    if (failNextMail) { failNextMail = false; throw new Error("simulated mail failure") }
    sent.push(message)
  } },
  Session: { getEffectiveUser: () => ({ getEmail: () => "organizer@mmdc.mcl.edu.ph" }) },
  Utilities: { getUuid: () => `uuid-${++uuid}`, newBlob: data => data },
  ContentService: { MimeType: { JSON: "application/json" }, createTextOutput: text => ({ text, setMimeType() { return this } }) },
  ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased() { return this }, everyMinutes() { return this }, create() {} }), deleteTrigger() {} },
}
vm.createContext(ctx)
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "..", "booking", "Code.gs"), "utf8"), ctx)

const event = body => ({ postData: { contents: JSON.stringify(body) } })
const created = JSON.parse(ctx.doPost(event({ action: "book", domainId: "d1", slotId: "2026-10-19_0900-1100", name: "Test Person", email: "tester@mmdc.mcl.edu.ph" })).text)
assert.equal(created.ok, true)
assert.equal(created.domainId, "d1")
assert.equal(Object.hasOwn(created, "accountStatus"), false, "public response must not disclose account state")
assert.equal(fetched.length, 1)
assert.equal(fetched[0].url, "https://cyberrange.bubble-express.win/api/booking/provision")
assert.equal(fetched[0].options.headers["X-Booking-Provision-Secret"], "unit-secret")
assert.equal(sheet.cells[1][14], "created")
assert.equal(sheet.cells[1][15], "yes")
assert.equal(sheet.cells[1][16], "created", "initial organizer notice records its account status")
assert.match(sent[0].body, /temporary password was emailed/i)
assert.match(sent[1].body, /separate email with your username and temporary password/i)

sheet.cells[1][0] = "2026-01-01T00:00:00.000Z"
sheet.cells[1][15] = ""
ctx.reconcilePendingProvisioning()
assert.equal(sheet.cells[1][15], "yes", "reconciliation marks a delivered organizer notice")
assert.equal(sheet.cells[1][16], "created", "retried initial notice records its account status")

const duplicate = JSON.parse(ctx.doPost(event({ action: "book", domainId: "d1", slotId: "2026-10-19_0900-1100", name: "Test Person", email: "tester@mmdc.mcl.edu.ph" })).text)
assert.equal(duplicate.error, "duplicate_time")
const cancelled = JSON.parse(ctx.doPost(event({ action: "cancel", domainId: "d1", slotId: "2026-10-19_0900-1100", token: created.token })).text)
assert.equal(cancelled.ok, true)
assert.equal(sheet.cells[1][12], "cancelled")

function addBookingRow(accountStatus, organizerNoticeSent, accountStatusNotified, slotId) {
  sheet.appendRow([
    "2026-01-01T00:00:00.000Z", "d1", "https://cyberrange.bubble-express.win/login", slotId,
    "2026-10-19", "09:00", "11:00", "Legacy Tester", "legacy@mmdc.mcl.edu.ph", "", "", "",
    "booked", "TOKEN123", accountStatus, organizerNoticeSent ? "yes" : "", accountStatusNotified,
  ])
  return sheet.getLastRow()
}

const legacyTerminalRow = addBookingRow("existing", true, "", "2026-10-20_0900-1100")
const legacySentBefore = sent.length
const legacyFetchBefore = fetched.length
ctx.reconcilePendingProvisioning()
assert.equal(sheet.cells[legacyTerminalRow - 1][16], "existing", "legacy terminal row backfills its already-notified status")
assert.equal(sent.length, legacySentBefore, "legacy terminal row does not send a duplicate status email")
assert.equal(fetched.length, legacyFetchBefore, "legacy terminal row is not re-provisioned")

const unknownRow = addBookingRow("unknown", true, "unknown", "2026-10-21_0900-1100")
fetchBody = { status: "existing" }
const unknownFetchBefore = fetched.length
const unknownMailBefore = sent.length
ctx.reconcilePendingProvisioning()
assert.equal(fetched.length, unknownFetchBefore + 1, "unknown rows are rechecked through their assigned domain")
assert.equal(sheet.cells[unknownRow - 1][14], "existing", "reconciled status is persisted")
assert.equal(sheet.cells[unknownRow - 1][16], "existing", "successful update mail records the notified status")
assert.equal(sent.length, unknownMailBefore + 1, "terminal status change emails organizers")
assert.match(sent.at(-1).body, /BOOKING ACCOUNT STATUS UPDATED/)

const legacyPendingRow = addBookingRow("pending", true, "", "2026-10-22_0900-1100")
fetchBody = { status: "created", credential_email_status: "sent" }
ctx.reconcilePendingProvisioning()
assert.equal(sheet.cells[legacyPendingRow - 1][14], "created", "legacy pending row reaches its terminal status")
assert.equal(sheet.cells[legacyPendingRow - 1][16], "created", "legacy pending row gets one terminal status notice")

const failedMailRow = addBookingRow("pending", true, "pending", "2026-10-23_0900-1100")
fetchBody = { status: "existing" }
failNextMail = true
const failedMailFetchBefore = fetched.length
ctx.reconcilePendingProvisioning()
assert.equal(sheet.cells[failedMailRow - 1][14], "existing", "account status persists even when the update email fails")
assert.equal(sheet.cells[failedMailRow - 1][16], "pending", "failed status email remains retryable")
const failedMailRetryFetchBefore = fetched.length
ctx.reconcilePendingProvisioning()
assert.equal(fetched.length, failedMailRetryFetchBefore, "failed status email retry does not call provisioning again")
assert.equal(failedMailRetryFetchBefore, failedMailFetchBefore + 1)
assert.equal(sheet.cells[failedMailRow - 1][16], "existing", "successful retry records the delivered status")

const overlapRow = addBookingRow("unknown", true, "unknown", "2026-10-24_0900-1100")
fetchReplies = [
  { code: 200, body: { status: "pending" } },
  { code: 200, body: { status: "created", credential_email_status: "sent" } },
]
const overlapFetchBefore = fetched.length
const overlapMailBefore = sent.length
fetchHook = () => ctx.reconcilePendingProvisioning()
ctx.reconcilePendingProvisioning()
assert.equal(fetched.length, overlapFetchBefore + 2, "overlapping runs may recheck but remain idempotent")
assert.equal(sheet.cells[overlapRow - 1][14], "created", "stale pending response cannot overwrite a terminal result")
assert.equal(sheet.cells[overlapRow - 1][16], "created", "only the terminal status is marked as notified")
assert.equal(sent.length, overlapMailBefore + 1, "overlapping runs do not duplicate the terminal status email")

const cancelledDuringFetchRow = addBookingRow("pending", true, "pending", "2026-10-25_0900-1100")
const cancelDuringFetchMailBefore = sent.length
fetchHook = () => { sheet.cells[cancelledDuringFetchRow - 1][12] = "cancelled" }
ctx.reconcilePendingProvisioning()
assert.equal(sheet.cells[cancelledDuringFetchRow - 1][14], "pending", "cancelled row is not updated after the outbound request")
assert.equal(sent.length, cancelDuringFetchMailBefore, "cancelled row receives no reconciliation notice")

fetchCode = 504
assert.equal(ctx.provision_({ domainId: "d1", email: "tester@mmdc.mcl.edu.ph", url: "https://cyberrange.bubble-express.win/login" }), "unknown", "timeout remains an ambiguous status")

console.log("Apps Script booking, pending/unknown reconciliation, legacy status backfill, update email retries, overlap/cancel races, opaque response, duplicate and cancellation checks passed.")
