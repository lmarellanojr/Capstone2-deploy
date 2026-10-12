const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")

const sent = []
const fetched = []
let uuid = 0
let fetchCode = 200
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
const lock = { waitLock() {}, tryLock() { return true }, releaseLock() {} }
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
  UrlFetchApp: { fetch: (url, options) => { fetched.push({ url, options }); return { getResponseCode: () => fetchCode, getContentText: () => JSON.stringify({ status: "created", credential_email_status: "sent" }) } } },
  MailApp: { sendEmail: message => sent.push(message) },
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
assert.match(sent[0].body, /temporary password was emailed/i)
assert.match(sent[1].body, /separate email with your username and temporary password/i)

sheet.cells[1][0] = "2026-01-01T00:00:00.000Z"
sheet.cells[1][15] = ""
ctx.reconcilePendingProvisioning()
assert.equal(sheet.cells[1][15], "yes", "reconciliation marks a delivered organizer notice")

const duplicate = JSON.parse(ctx.doPost(event({ action: "book", domainId: "d1", slotId: "2026-10-19_0900-1100", name: "Test Person", email: "tester@mmdc.mcl.edu.ph" })).text)
assert.equal(duplicate.error, "duplicate_time")
const cancelled = JSON.parse(ctx.doPost(event({ action: "cancel", domainId: "d1", slotId: "2026-10-19_0900-1100", token: created.token })).text)
assert.equal(cancelled.ok, true)
assert.equal(sheet.cells[1][12], "cancelled")
fetchCode = 504
assert.equal(ctx.provision_({ domainId: "d1", email: "tester@mmdc.mcl.edu.ph", url: "https://cyberrange.bubble-express.win/login" }), "unknown", "timeout remains an ambiguous status")

console.log("Apps Script booking, domain routing, opaque response, status persistence, email notices, duplicate and cancellation checks passed.")
