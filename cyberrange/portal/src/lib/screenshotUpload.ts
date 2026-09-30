import { reviews } from "@/lib/api"
import { backendDetail } from "@/lib/errorHandler"
import { prepareScreenshot, ScreenshotError } from "@/lib/imageCompress"

/**
 * Attach screenshots to a review that already exists. One file failing doesn't
 * stop the rest, and never fails the request itself (re-sending would create a
 * duplicate case), so the caller gets back a user-safe message per failure.
 */
export async function uploadScreenshots(reviewId: number, files: File[]): Promise<string[]> {
  const failures: string[] = []
  for (const file of files) {
    try {
      const { blob, name } = await prepareScreenshot(file)
      await reviews.uploadImage(reviewId, blob, name)
    } catch (err) {
      failures.push(err instanceof ScreenshotError ? err.message : `${file.name}: ${backendDetail(err)}`)
    }
  }
  return failures
}
