/**
 * Get a student's screenshot ready to upload.
 *
 * The origin nginx in front of the portal caps request bodies at 1 MB (its
 * default), and phone photos / full-screen captures are often 2-5 MB. Anything
 * over MAX_UPLOAD_BYTES is redrawn on a canvas at most MAX_SIDE px on its long
 * side and re-encoded (WebP, falling back to JPEG) at decreasing quality until
 * it fits. Small files go up untouched. The server re-validates and strips
 * metadata either way; this is about size, not trust.
 */

export const MAX_UPLOAD_BYTES = 900 * 1024
export const MAX_FILES = 5
export const MAX_SIDE = 1920
export const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"] as const

export class ScreenshotError extends Error {}

export function isAcceptedType(type: string): boolean {
  return (ACCEPTED_TYPES as readonly string[]).includes(type)
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new ScreenshotError("That image couldn't be read."))
    }
    img.src = url
  })
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality))
}

export async function prepareScreenshot(file: File): Promise<{ blob: Blob; name: string }> {
  if (!isAcceptedType(file.type)) {
    throw new ScreenshotError(`${file.name}: only PNG, JPEG or WebP images can be attached.`)
  }
  if (file.size <= MAX_UPLOAD_BYTES) return { blob: file, name: file.name }

  const img = await loadImage(file)
  let scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
  const base = file.name.replace(/\.[^.]+$/, "") || "screenshot"

  for (let round = 0; round < 3; round++) {
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext("2d")
    if (!ctx) break
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    for (const quality of [0.9, 0.8, 0.7, 0.6]) {
      let blob = await toBlob(canvas, "image/webp", quality)
      // Browsers without WebP encoding hand back PNG; use JPEG there instead.
      if (!blob || blob.type !== "image/webp") blob = await toBlob(canvas, "image/jpeg", quality)
      if (blob && blob.size <= MAX_UPLOAD_BYTES) {
        const ext = blob.type === "image/webp" ? "webp" : "jpg"
        return { blob, name: `${base}.${ext}` }
      }
    }
    scale *= 0.75
  }
  throw new ScreenshotError(`${file.name} is too large to attach even after shrinking it.`)
}
