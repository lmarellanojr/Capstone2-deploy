import { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { mapErrorToMessage, isAuthError } from '@/lib/errorHandler';

const POLL_INTERVAL_MS = 2500; // 2.5 seconds
const STUCK_DESTROY_WARNING_MS = 5 * 60 * 1000; // 5 minutes

// Exported for useAdminDestroyPoll.ts (ADM-UI review, PR #82) -- same
// retryable-error rule, shared instead of a third copy drifting from this one.
export function httpStatus(err: unknown): number | undefined {
  if (axios.isAxiosError(err)) return err.response?.status;
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const status = (err as { response?: { status?: number } }).response?.status;
    return typeof status === 'number' ? status : undefined;
  }
  return undefined;
}

/** 5xx, timeout, and connection failures are retryable during MVP polling. */
export function isTransientPollError(err: unknown): boolean {
  const status = httpStatus(err);
  if (status !== undefined && status >= 500 && status < 600) return true;
  if (axios.isAxiosError(err)) {
    if (err.response == null) return true;
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || err.code === 'ERR_NETWORK') {
      return true;
    }
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (msg.includes('timeout') || msg.includes('network') || msg.includes('econnrefused')) {
      return true;
    }
  }
  return false;
}

interface UseStatusPollerOptions {
  interval?: number;
  onTerminal?: (status: string) => void;
  onError?: (error: string) => void;
}

interface UseStatusPollerResult {
  status: string | null;
  error: string | null;
  isPolling: boolean;
  stuckDestroyWarning: boolean;
  stop: () => void;
  restart: () => void;
}

export function useStatusPoller(
  podId: number,
  phase: 'create' | 'destroy',
  options?: UseStatusPollerOptions
): UseStatusPollerResult {
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(true);
  const [stuckDestroyWarning, setStuckDestroyWarning] = useState(false);
  const [startTime, setStartTime] = useState<number>(Date.now());

  const { interval = POLL_INTERVAL_MS, onTerminal, onError } = options || {};

  const stop = useCallback(() => {
    setIsPolling(false);
  }, []);

  // Restarts polling after an error (or after a manual stop). Clears the
  // error so the error view is dismissed, resets the stuck-destroy timer
  // baseline, and flips isPolling back on so the polling effect resumes.
  const restart = useCallback(() => {
    setError(null);
    setStuckDestroyWarning(false);
    setStartTime(Date.now());
    setIsPolling(true);
  }, []);

  // Phase-aware terminal detection (CRITICAL FIX)
  const isTerminal = (s: string | null): boolean => {
    if (!s) return false;

    if (phase === 'create') {
      // Create terminal: ACTIVE (success) or FAILED_ROLLBACK_COMPLETE (failure)
      return s === 'ACTIVE' || s === 'FAILED_ROLLBACK_COMPLETE';
    } else {
      // Destroy terminal: DESTROYED (success) or 404 (handled in fetch)
      // ACTIVE is NOT terminal for destroy; DESTROYING is NOT terminal
      return s === 'DESTROYED';
    }
  };

  // Polling effect
  useEffect(() => {
    if (!isPolling || !podId) return;

    const pollInterval = setInterval(async () => {
      try {
        // CRITICAL FIX R5: Use apiProxy pattern (server-side routing via session cookie)
        // instead of client-side Bearer injection. apiProxy handles token + introspection.
        // Call: GET /api/pods/{id}/status (portal route proxies to provision API with session token)
        const response = await axios.get(`/api/pods/${podId}/status`);
        const newStatus = response.data.status;
        setStatus(newStatus);
        setError(null);

        // Check for terminal state
        if (isTerminal(newStatus)) {
          setIsPolling(false);
          if (onTerminal) onTerminal(newStatus);
        }

        // Stuck-destroy warning: DESTROYING for >5 min
        if (newStatus === 'DESTROYING') {
          const elapsed = Date.now() - startTime;
          if (elapsed > STUCK_DESTROY_WARNING_MS) {
            setStuckDestroyWarning(true);
          }
        } else {
          // Reset stuck-destroy warning when pod transitions out of DESTROYING state
          setStuckDestroyWarning(false);
        }
      } catch (err: unknown) {
        // CRITICAL FIX R4: 404 only treated as success during destroy phase
        // During create phase, 404 is an error (pod should exist if provisioning succeeded)
        const status = httpStatus(err);
        if (status === 404 && phase === 'destroy') {
          // Pod row deleted by API (successful destroy); treat as terminal success
          setStatus('DESTROYED');
          setIsPolling(false);
          setStuckDestroyWarning(false); // Reset warning on successful 404 destroy
          if (onTerminal) onTerminal('DESTROYED');
        } else if (status === 401 || isAuthError(err)) {
          const { message } = mapErrorToMessage(err);
          setError(message);
          setIsPolling(false);
          if (typeof window !== 'undefined') {
            try {
              window.location.href = '/login?error=SessionExpired';
            } catch {
              // jsdom / non-browser hosts may reject navigation
            }
          }
          if (onError) onError(message);
        } else if (isTransientPollError(err)) {
          // 5xx / timeout / network blip: keep polling. Do not set a fatal
          // error or call onError — the next interval will retry.
        } else {
          const { message } = mapErrorToMessage(err);
          setError(message);
          setIsPolling(false);
          if (onError) onError(message);
        }
      }
    }, interval);

    return () => clearInterval(pollInterval);
  }, [isPolling, podId, interval, onTerminal, onError]);

  return {
    status,
    error,
    isPolling,
    stuckDestroyWarning,
    stop,
    restart,
  };
}

// NOTE (R5 fix): Bearer token injection removed. Use apiProxy pattern instead:
// Portal routes (src/app/api/pods/[id]/status, etc.) handle token injection server-side
// via getServerSession() and axios calls to provision API with Bearer from NextAuth.
