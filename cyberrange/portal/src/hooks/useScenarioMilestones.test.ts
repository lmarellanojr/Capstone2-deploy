/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react'
import { useScenarioMilestones } from './useScenarioMilestones'
import { provisioning } from '@/lib/api'
import { SCENARIOS } from '@/hooks/useScenarios'

const mockSuccess = jest.fn()
const mockWarning = jest.fn()
const mockError = jest.fn()

jest.mock('@/context/ToastContext', () => ({
  useToastContext: () => ({
    success: mockSuccess,
    warning: mockWarning,
    error: mockError,
  }),
}))

jest.mock('@/lib/api', () => ({
  provisioning: {
    getMilestones: jest.fn(),
    verifyMilestone: jest.fn(),
  },
}))

describe('useScenarioMilestones', () => {
  const scen1 = SCENARIOS.find((s) => s.id === '01')!
  const scen3 = SCENARIOS.find((s) => s.id === '09')!

  beforeEach(() => {
    jest.clearAllMocks()
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('handles null podId safely without polling or fetching', () => {
    const { result } = renderHook(() => useScenarioMilestones(null, '01', scen1.milestones))
    expect(provisioning.getMilestones).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
    expect(result.current.completed.size).toBe(0)
    expect(result.current.milestonesLoading).toBe(false)
  })

  it('runs initial fetch and establishes a single 3s polling interval', async () => {
    ;(provisioning.getMilestones as jest.Mock).mockResolvedValue({
      milestones: [{ scenario_id: 1, milestone_id: 1, status: 'PASS' }],
      manual_check_locked: [],
    })

    const { result, unmount } = renderHook(() => useScenarioMilestones(42, '01', scen1.milestones))
    expect(result.current.milestonesLoading).toBe(true)

    await act(async () => {
      // Resolve initial fetch promise
    })

    expect(result.current.milestonesLoading).toBe(false)
    expect(result.current.completed.has(1)).toBe(true)
    expect(provisioning.getMilestones).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(1)

    // Advance 3 seconds for 1 poll tick
    ;(provisioning.getMilestones as jest.Mock).mockResolvedValueOnce({
      milestones: [
        { scenario_id: 1, milestone_id: 1, status: 'PASS' },
        { scenario_id: 1, milestone_id: 2, status: 'PASS' },
      ],
      manual_check_locked: [],
    })

    await act(async () => {
      jest.advanceTimersByTime(3000)
    })

    expect(provisioning.getMilestones).toHaveBeenCalledTimes(2)
    expect(result.current.completed.has(2)).toBe(true)
    expect(mockSuccess).toHaveBeenCalledWith(expect.stringContaining('+50 pts'))

    // Clean unmount clears interval
    unmount()
    expect(jest.getTimerCount()).toBe(0)
  })

  it('discards late responses from previous podId', async () => {
    let resolveFirst: (val: any) => void = () => {}
    const firstPromise = new Promise((resolve) => {
      resolveFirst = resolve
    })

    ;(provisioning.getMilestones as jest.Mock).mockReturnValueOnce(firstPromise)

    const { result, rerender } = renderHook(
      ({ podId }) => useScenarioMilestones(podId, '01', scen1.milestones),
      { initialProps: { podId: 10 } }
    )

    // Switch pod to 11 before first resolves
    ;(provisioning.getMilestones as jest.Mock).mockResolvedValueOnce({
      milestones: [{ scenario_id: 1, milestone_id: 3, status: 'PASS' }],
    })

    rerender({ podId: 11 })

    await act(async () => {
      // Resolve first delayed promise
      resolveFirst({
        milestones: [{ scenario_id: 1, milestone_id: 1, status: 'PASS' }],
      })
    })

    // It should have milestone 3 (from pod 11), NOT milestone 1 (from stale pod 10)
    expect(result.current.completed.has(3)).toBe(true)
    expect(result.current.completed.has(1)).toBe(false)
  })

  it('stops polling on 401 terminal error', async () => {
    ;(provisioning.getMilestones as jest.Mock).mockResolvedValueOnce({ milestones: [] })

    renderHook(() => useScenarioMilestones(55, '01', scen1.milestones))
    await act(async () => {})
    expect(jest.getTimerCount()).toBe(1)

    ;(provisioning.getMilestones as jest.Mock).mockRejectedValueOnce({
      response: { status: 401 },
    })

    await act(async () => {
      jest.advanceTimersByTime(3000)
    })

    expect(jest.getTimerCount()).toBe(0)
  })

  it('preserves optimistic completion during polling tick when backend response lacks it', async () => {
    ;(provisioning.getMilestones as jest.Mock).mockResolvedValueOnce({
      milestones: [{ scenario_id: 1, milestone_id: 1, status: 'PASS' }],
      manual_check_locked: [],
    })

    const { result } = renderHook(() => useScenarioMilestones(42, '01', scen1.milestones))
    await act(async () => {})

    expect(result.current.completed.has(1)).toBe(true)

    // Optimistically mark milestone 5 as passed (e.g. flag submission)
    act(() => {
      result.current.onFlagPassed(5)
    })
    expect(result.current.completed.has(5)).toBe(true)

    // Polling tick brings milestone 2 from backend, but backend does not yet include milestone 5
    ;(provisioning.getMilestones as jest.Mock).mockResolvedValueOnce({
      milestones: [
        { scenario_id: 1, milestone_id: 1, status: 'PASS' },
        { scenario_id: 1, milestone_id: 2, status: 'PASS' },
      ],
      manual_check_locked: [],
    })

    await act(async () => {
      jest.advanceTimersByTime(3000)
    })

    // Both newPassed (1, 2) and optimistic milestone 5 must remain in completed
    expect(result.current.completed.has(1)).toBe(true)
    expect(result.current.completed.has(2)).toBe(true)
    expect(result.current.completed.has(5)).toBe(true)
  })

  it('calculates Scenario 3 score progress from its scored milestones only', async () => {
    ;(provisioning.getMilestones as jest.Mock).mockResolvedValueOnce({
      milestones: [{ scenario_id: 9, milestone_id: 1, status: 'PASS' }],
      manual_check_locked: [],
    })

    const { result } = renderHook(() => useScenarioMilestones(42, '09', scen3.milestones))
    await act(async () => {})

    expect(result.current.completed).toEqual(new Set([1]))
    expect(result.current.totalPoints).toBe(225)
    expect(result.current.earnedPoints).toBe(50)
    expect(result.current.doneCount).toBe(1)
    expect(result.current.progressPct).toBe(22)
    expect(result.current.nextMilestoneId).toBe(2)
    expect(scen3.prepTask?.id).toBe(0)
    expect(scen3.milestones.map((milestone) => milestone.id)).toEqual([1, 2, 3])
  })
})
