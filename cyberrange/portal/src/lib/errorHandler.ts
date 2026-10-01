/**
 * Error Handler & Toast System
 *
 * Centralizes error handling for pod lifecycle operations (provision, destroy, polling).
 * Maps HTTP status codes and error details to user-friendly toast messages.
 */

import axios, { AxiosError } from 'axios'

export type ToastType = 'error' | 'warning' | 'info' | 'success'

/**
 * Analyzes an error response and returns a user-friendly message.
 * Handles:
 *  - 401: Authentication failed (suggests re-login)
 *  - 409: Already provisioned (pod exists, destroy first)
 *  - 503: Capacity or storage full
 *  - 404: Pod not found
 *  - 5xx: Server errors
 *  - Network errors (timeout, no connection)
 */
export function mapErrorToMessage(error: unknown): { message: string; type: ToastType } {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    const data = error.response?.data

    switch (status) {
      case 401:
        return {
          message: 'Authentication expired. Please log in again.',
          type: 'error',
        }

      case 409:
        // Detail can be {error: "ALREADY_PROVISIONED"} or {detail: "..."}
        const errorCode =
          typeof data === 'object' && data !== null
            ? (data as any).error || (data as any).detail
            : String(data || '')

        const errorCodeStr = typeof errorCode === 'string' ? errorCode : String(errorCode || '')

        if (
          errorCodeStr === 'ALREADY_PROVISIONED' ||
          errorCodeStr.includes('already') ||
          errorCodeStr.toLowerCase().includes('already')
        ) {
          return {
            message: 'You already have an active pod. Destroy it from your dashboard first.',
            type: 'warning',
          }
        }
        return {
          message: 'Cannot perform this action on the pod in its current state.',
          type: 'warning',
        }

      case 503:
        // Detail can include capacity or storage error codes
        const serviceDetail =
          typeof data === 'object' && data !== null
            ? (data as any).detail || (data as any).error || ''
            : String(data || '')
        const serviceDetailStr = typeof serviceDetail === 'object' ? JSON.stringify(serviceDetail) : String(serviceDetail || '')

        if (serviceDetailStr.includes('POD_CAP_REACHED') || serviceDetailStr.includes('capacity')) {
          return {
            message: 'The range is at capacity. Please try again in a few moments.',
            type: 'warning',
          }
        }
        if (serviceDetailStr.includes('RAM_FULL') || serviceDetailStr.includes('need') && serviceDetailStr.includes('MB')) {
          return {
            message: 'The host does not have enough free memory to start a new pod. Destroy any leftover labs or try again in a moment.',
            type: 'warning',
          }
        }
        if (serviceDetailStr.includes('STORAGE_FULL') || serviceDetailStr.includes('storage')) {
          return {
            message: 'Storage is full. Please try again later.',
            type: 'warning',
          }
        }
        return {
          message: 'Service is temporarily unavailable. Please try again soon.',
          type: 'warning',
        }

      case 404:
        return {
          message: 'Pod not found or already destroyed.',
          type: 'info',
        }

      case 500:
      case 502:
      case 504:
        return {
          message: 'Service error. Please try again later or contact support.',
          type: 'error',
        }

      default:
        // Generic API error; include detail if available
        const fallbackDetail =
          typeof data === 'object' && data !== null
            ? (data as any).detail || (data as any).error || (data as any).message
            : String(data || '')
        const fallbackMsg = typeof fallbackDetail === 'string' ? fallbackDetail : error.message || 'An error occurred. Please try again.'
        return {
          message: fallbackMsg,
          type: 'error',
        }
    }
  }

  // Handle network errors (timeout, no connection)
  if (error instanceof Error) {
    if (error.message.includes('timeout')) {
      return {
        message: 'Request timed out. Please try again.',
        type: 'error',
      }
    }
    if (error.message.includes('ECONNREFUSED') || error.message.includes('Network')) {
      return {
        message: 'Network connection failed. Please check your internet and try again.',
        type: 'error',
      }
    }
    return {
      message: error.message,
      type: 'error',
    }
  }

  return {
    message: 'An unexpected error occurred. Please try again.',
    type: 'error',
  }
}

/**
 * Checks if an error is an auth error (401) that requires re-login.
 * Used to trigger redirect to login page.
 */
export function isAuthError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return error.response?.status === 401
  }
  return false
}

/**
 * Checks if an error is a conflict error (409) indicating pod already exists.
 */
export function isConflictError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return error.response?.status === 409
  }
  return false
}

/**
 * Checks if an error is a capacity/service error (503).
 */
export function isCapacityError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return error.response?.status === 503
  }
  return false
}

/**
 * Checks if an error is a not-found error (404).
 */
export function isNotFoundError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return error.response?.status === 404
  }
  return false
}

/**
 * Checks if an error is a forbidden error (403) — authenticated but insufficient role.
 */
export function isForbiddenError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return error.response?.status === 403
  }
  return false
}

/**
 * Checks if an error is a server error (5xx).
 */
export function isServerError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status
    return status !== undefined && status >= 500 && status < 600
  }
  return false
}

/**
 * The backend's own explanation of a failed request, when it gave one.
 *
 * mapErrorToMessage() speaks pod-lifecycle ("You already have an active
 * pod…" for any 409), which is wrong for user management and review cases:
 * there the FastAPI `detail` is the precise, user-safe reason ("Username or
 * email already exists", "Only reviews in RETRY status can be resubmitted").
 * FastAPI 422s carry a list of {loc, msg} validation errors instead of a
 * string; the first message is surfaced. Falls back to mapErrorToMessage().
 */
export function backendDetail(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { detail?: unknown; error?: unknown } | undefined
    const detail = data?.detail ?? data?.error
    if (typeof detail === 'string' && detail.trim()) return detail
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: unknown; loc?: unknown }
      if (typeof first?.msg === 'string') {
        const field = Array.isArray(first.loc) ? first.loc[first.loc.length - 1] : null
        return typeof field === 'string' ? `${field}: ${first.msg}` : first.msg
      }
    }
  }
  return mapErrorToMessage(error).message
}
