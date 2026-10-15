/** Small CSV helpers for instructor downloads (no extra deps). */

export function csvEscape(value: unknown): string {
  const text = value == null ? "" : String(value)
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function rowsToCsv(headers: string[], rows: Array<Array<unknown>>): string {
  const lines = [headers.map(csvEscape).join(",")]
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","))
  }
  return `${lines.join("\r\n")}\r\n`
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>): void {
  const csv = rowsToCsv(headers, rows)
  saveBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), filename)
}
