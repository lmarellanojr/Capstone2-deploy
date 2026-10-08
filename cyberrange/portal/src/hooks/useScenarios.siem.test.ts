import { SCENARIOS, getLabSurface } from './useScenarios'

describe('getLabSurface + Scenario 3 prep metadata', () => {
  it('maps known catalog ids and explicit metadata', () => {
    expect(getLabSurface({ id: '01', labSurface: 'terminal' })).toBe('terminal')
    expect(getLabSurface({ id: '06', labSurface: 'dvwa' })).toBe('dvwa')
    expect(getLabSurface({ id: '09', labSurface: 'siem' })).toBe('siem')
    // Legacy callers without metadata still resolve by id.
    expect(getLabSurface({ id: '09' })).toBe('siem')
    expect(getLabSurface({ id: '06' })).toBe('dvwa')
    expect(getLabSurface({ id: '99' })).toBe('terminal')
  })

  it('keeps Scenario 3 prep outside scored milestones', () => {
    const scen3 = SCENARIOS.find((s) => s.id === '09')
    expect(scen3).toBeTruthy()
    expect(scen3!.labSurface).toBe('siem')
    expect(scen3!.prepTask?.id).toBe(0)
    expect(scen3!.prepTask?.unscored).toBe(true)
    expect(scen3!.milestones.map((m) => m.id)).toEqual([1, 2, 3])
    expect(scen3!.milestones.every((m) => !m.unscored)).toBe(true)
    const points = scen3!.milestones.reduce((sum, m) => sum + m.points, 0)
    expect(points).toBe(225)
  })
})
