/**
 * @jest-environment jsdom
 */

import React from "react"
import "@testing-library/jest-dom"
import { act, render, screen } from "@testing-library/react"
import { EvidenceScreenshots } from "./EvidenceScreenshots"
import { reviews } from "@/lib/api"

jest.mock("@/lib/api", () => ({
  reviews: {
    listImages: jest.fn(),
    imageUrl: (r: number, i: number) => `/api/reviews/${r}/images/${i}`,
  },
}))
jest.mock("@/components/ui", () => ({ LoadingSpinner: ({ message }: { message: string }) => <p>{message}</p> }))

const listImages = reviews.listImages as jest.Mock

async function flush() {
  await act(async () => {
    await Promise.resolve()
  })
}

it("shows each screenshot linked to its full-size image", async () => {
  listImages.mockResolvedValue({
    review_id: 5,
    images: [
      { id: 2, review_id: 5, original_name: "siem.png", content_type: "image/png", byte_size: 240000, width: 1280, height: 720, caption: null, created_at: "2026-09-30 04:10:02" },
    ],
  })
  render(<EvidenceScreenshots reviewId={5} />)
  await flush()

  const img = screen.getByAltText("siem.png")
  expect(img).toHaveAttribute("src", "/api/reviews/5/images/2")
  expect(img.closest("a")).toHaveAttribute("href", "/api/reviews/5/images/2")
  expect(screen.getByText(/1280×720/)).toBeInTheDocument()
})

it("says when nothing was attached", async () => {
  listImages.mockResolvedValue({ review_id: 5, images: [] })
  render(<EvidenceScreenshots reviewId={5} />)
  await flush()
  expect(screen.getByText(/No screenshots were attached/)).toBeInTheDocument()
})
