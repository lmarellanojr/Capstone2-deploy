import { csvEscape, rowsToCsv } from "./csvExport"

describe("csvEscape", () => {
  it("leaves plain values alone", () => {
    expect(csvEscape("PASS")).toBe("PASS")
    expect(csvEscape(0)).toBe("0")
    expect(csvEscape(null)).toBe("")
  })

  it("quotes commas, quotes, and newlines", () => {
    expect(csvEscape('rule "5710", sshd')).toBe('"rule ""5710"", sshd"')
    expect(csvEscape("a\nb")).toBe('"a\nb"')
  })

  it("neutralizes formula-leading cells for spreadsheet opens", () => {
    expect(csvEscape('=HYPERLINK("http://evil")')).toBe(`"'=HYPERLINK(""http://evil"")"`)
    expect(csvEscape("+cmd")).toBe("'+cmd")
    expect(csvEscape("-1+1")).toBe("'-1+1")
    expect(csvEscape("@SUM(A1)")).toBe("'@SUM(A1)")
  })
})

describe("rowsToCsv", () => {
  it("emits a header row and CRLF lines", () => {
    expect(rowsToCsv(["a", "b"], [[1, "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n')
  })
})
