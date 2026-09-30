/** @jest-environment jsdom */
import { forgetReviews, readTrackedReviews, trackReview } from "./myReviews"

const r = (reviewId: number, milestoneId: number | null = 1) => ({
  reviewId,
  scenarioId: "01",
  milestoneId,
  createdAt: "2026-09-30T00:00:00.000Z",
})

beforeEach(() => window.localStorage.clear())

describe("myReviews", () => {
  it("tracks newest first and de-duplicates by review id", () => {
    trackReview("stu1", r(1))
    trackReview("stu1", r(2))
    trackReview("stu1", r(1))
    expect(readTrackedReviews("stu1").map((x) => x.reviewId)).toEqual([1, 2])
  })

  it("keeps each student's requests separate on a shared computer", () => {
    trackReview("alice", r(10))
    trackReview("bob", r(20))
    expect(readTrackedReviews("alice").map((x) => x.reviewId)).toEqual([10])
    expect(readTrackedReviews("bob").map((x) => x.reviewId)).toEqual([20])
  })

  it("forgets ids the backend no longer returns", () => {
    trackReview("stu1", r(1))
    trackReview("stu1", r(2))
    expect(forgetReviews("stu1", [1]).map((x) => x.reviewId)).toEqual([2])
    expect(readTrackedReviews("stu1").map((x) => x.reviewId)).toEqual([2])
  })

  it("ignores corrupt or tampered storage instead of crashing", () => {
    window.localStorage.setItem("cr.myReviews.stu1", "{not json")
    expect(readTrackedReviews("stu1")).toEqual([])
    window.localStorage.setItem("cr.myReviews.stu1", JSON.stringify([{ reviewId: "1" }, r(3)]))
    expect(readTrackedReviews("stu1").map((x) => x.reviewId)).toEqual([3])
  })

  it("does nothing without a student id", () => {
    expect(trackReview("", r(1))).toEqual([])
    expect(readTrackedReviews("")).toEqual([])
  })
})
