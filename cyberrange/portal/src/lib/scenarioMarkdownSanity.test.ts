import fs from 'fs'
import path from 'path'

describe('Scenario 1 Markdown Sanity', () => {
  const filePath = path.resolve(
    __dirname,
    '../../public/scenarios/scenario_01_network_reconnaissance.md'
  )

  it('contains properly formatted blockquote callouts for all targeted labels', () => {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split(/\r?\n/)

    let inCodeFence = false
    const unformattedLines: { lineNum: number; text: string }[] = []

    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        inCodeFence = !inCodeFence
        return
      }
      if (inCodeFence) return

      // Check for unquoted bold labels at line starts
      if (
        /^(What you can do with this|If something's off|Scoring detail|Shortcut)\b/i.test(
          trimmed
        )
      ) {
        unformattedLines.push({ lineNum: index + 1, text: trimmed })
      }
    })

    expect(unformattedLines).toEqual([])
  })

  it('preserves all required environment variable placeholders', () => {
    const content = fs.readFileSync(filePath, 'utf-8')

    expect(content).toContain('$TARGET_SUBNET')
    expect(content).toContain('$TARGET_META')
    expect(content).toContain('$TARGET_DVWA')
    expect(content).toContain('$TARGET_KALI')
  })
})

describe('Scenario 2 Markdown Sanity', () => {
  const filePath = path.resolve(
    __dirname,
    '../../public/scenarios/scenario_02_web_application_attack_sql_injection.md'
  )

  it('contains properly formatted blockquote callouts for all targeted labels without run-ons', () => {
    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.split(/\r?\n/)

    let inCodeFence = false
    const unformattedLines: { lineNum: number; text: string }[] = []

    lines.forEach((line, index) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
        inCodeFence = !inCodeFence
        return
      }
      if (inCodeFence) return

      if (
        /^(What you can do with this|About `-- -`|What you'll see|Reflected vs stored XSS|So the result has to actually appear)\b/i.test(
          trimmed
        )
      ) {
        unformattedLines.push({ lineNum: index + 1, text: trimmed })
      }
    })

    expect(unformattedLines).toEqual([])
  })

  it('contains proper blockquotes for What you can do with this', () => {
    const content = fs.readFileSync(filePath, 'utf-8')
    const matches = content.match(/> \*\*What you can do with this:\*\*/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(4)
  })
})
