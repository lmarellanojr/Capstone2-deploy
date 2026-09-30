import { uploadScreenshots } from "./screenshotUpload"
import { reviews } from "@/lib/api"

jest.mock("@/lib/api", () => ({ reviews: { uploadImage: jest.fn() } }))
const uploadImage = reviews.uploadImage as jest.Mock

beforeEach(() => uploadImage.mockReset())

it("uploads each file and keeps going after one fails", async () => {
  uploadImage
    .mockResolvedValueOnce({ id: 1 })
    .mockRejectedValueOnce({ response: { status: 400, data: { detail: "file is not a valid PNG, JPEG, or WebP image" } } })
    .mockResolvedValueOnce({ id: 3 })
  const files = ["a.png", "b.png", "c.png"].map((n) => new File([new Uint8Array(10)], n, { type: "image/png" }))

  const failed = await uploadScreenshots(7, files)

  expect(uploadImage).toHaveBeenCalledTimes(3)
  expect(uploadImage.mock.calls[0][0]).toBe(7)
  expect(failed).toHaveLength(1)
  expect(failed[0]).toMatch(/^b\.png:/)
})

it("reports a wrong type without calling the API", async () => {
  const failed = await uploadScreenshots(7, [new File(["x"], "x.gif", { type: "image/gif" })])
  expect(uploadImage).not.toHaveBeenCalled()
  expect(failed[0]).toMatch(/only PNG, JPEG or WebP/)
})
