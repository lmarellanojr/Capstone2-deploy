'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import {
  createSession,
  destroySession,
  getSession,
  isSessionLive,
  refit,
  sessionKey,
  type TermSession,
} from './terminalSessionManager';

interface XtermViewProps {
  podId: number;
  podType: 'kali' | 'meta' | 'dvwa';
  token: string;
}

/** Backoff delays (ms) for optional auto-reconnect attempts. */
export const RECONNECT_BACKOFF_MS = [1000, 2000, 4000] as const;

const DISCONNECT_BANNER =
  'Terminal connection lost. Click Reconnect or refresh the page first. ' +
  'If reconnect fails and the lab pod was destroyed, use Start new session from the lab controls.';

function buildWsUrl(token: string, podId: number, podType: string): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ssh-websocket?token=${encodeURIComponent(
    token
  )}&pod_id=${podId}&pod_type=${podType}`;
}

export function XtermView({ podId, podType, token }: XtermViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<TermSession | undefined>(undefined);
  const attemptRef = useRef(0);
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unmountedRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  const clearAutoTimer = useCallback(() => {
    if (autoTimerRef.current != null) {
      clearTimeout(autoTimerRef.current);
      autoTimerRef.current = null;
    }
  }, []);

  const attachSession = useCallback((session: TermSession) => {
    const container = containerRef.current;
    if (!container) return;
    sessionRef.current = session;
    session.onError = setError;
    session.onOpen = () => {
      if (unmountedRef.current) return;
      attemptRef.current = 0;
      setDisconnected(false);
      setReconnecting(false);
      setError(null);
    };
    session.onClose = () => {
      if (unmountedRef.current) return;
      sessionRef.current = undefined;
      setDisconnected(true);
      setReconnecting(false);
    };
    if (session.host.parentNode !== container) {
      container.appendChild(session.host);
    }
    setTimeout(() => {
      refit(session);
      try { session.term.focus(); } catch { /* not ready */ }
    }, 50);
  }, []);

  const connect = useCallback(() => {
    const key = sessionKey(podId, podType);
    const wsUrl = buildWsUrl(token, podId, podType);
    // Drop any dead or lingering entry so createSession can open a fresh socket.
    if (!isSessionLive(key)) {
      destroySession(key);
    }
    let session = getSession(key);
    if (!session || !isSessionLive(key)) {
      session = createSession(key, wsUrl);
    }
    attachSession(session);
    setDisconnected(false);
    setReconnecting(false);
    setError(null);
  }, [attachSession, podId, podType, token]);

  const scheduleAutoReconnect = useCallback(() => {
    clearAutoTimer();
    const attempt = attemptRef.current;
    if (attempt >= RECONNECT_BACKOFF_MS.length) return;
    const delay = RECONNECT_BACKOFF_MS[attempt];
    autoTimerRef.current = setTimeout(() => {
      if (unmountedRef.current) return;
      attemptRef.current = attempt + 1;
      setReconnecting(true);
      try {
        connect();
      } catch {
        setReconnecting(false);
        setDisconnected(true);
        scheduleAutoReconnect();
      }
    }, delay);
  }, [clearAutoTimer, connect]);

  const handleReconnect = useCallback(() => {
    clearAutoTimer();
    attemptRef.current = 0;
    setReconnecting(true);
    destroySession(sessionKey(podId, podType));
    try {
      connect();
    } catch {
      setReconnecting(false);
      setDisconnected(true);
      scheduleAutoReconnect();
    }
  }, [clearAutoTimer, connect, podId, podType, scheduleAutoReconnect]);

  // Initial mount / identity change: open or re-attach a live session.
  useEffect(() => {
    unmountedRef.current = false;
    const container = containerRef.current;
    if (!container) return;

    const key = sessionKey(podId, podType);
    let session = getSession(key);
    if (!session || !isSessionLive(key)) {
      if (session) destroySession(key);
      session = createSession(key, buildWsUrl(token, podId, podType));
    }
    attachSession(session);
    attemptRef.current = 0;
    setDisconnected(false);

    const onWindowResize = () => {
      if (sessionRef.current) refit(sessionRef.current);
    };
    window.addEventListener('resize', onWindowResize);
    const ro = new ResizeObserver(onWindowResize);
    ro.observe(container);

    return () => {
      unmountedRef.current = true;
      clearAutoTimer();
      window.removeEventListener('resize', onWindowResize);
      ro.disconnect();
      const s = sessionRef.current;
      if (s) {
        s.onError = undefined;
        s.onClose = undefined;
        s.onOpen = undefined;
        if (s.host.parentNode === container) {
          container.removeChild(s.host);
        }
      }
      // Detach only — session may stay alive across tab switches while WS is live.
    };
  }, [attachSession, clearAutoTimer, podId, podType, token]);

  // When disconnected, kick optional auto-reconnect with backoff.
  useEffect(() => {
    if (!disconnected || reconnecting) return;
    scheduleAutoReconnect();
    return clearAutoTimer;
  }, [disconnected, reconnecting, scheduleAutoReconnect, clearAutoTimer]);

  return (
    // BUG-035: bounded positioning context; the terminal mount is absolute so it
    // can't drive layout height (FitAddon over-sized the page otherwise).
    <div className="relative w-full h-full overflow-hidden bg-black">
      {error && !disconnected && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-red-600/95 text-white p-2 text-sm border-b border-red-700 flex justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="hover:text-white" aria-label="Dismiss error">
            &times;
          </button>
        </div>
      )}
      {disconnected && (
        <div
          role="status"
          data-testid="terminal-reconnect-banner"
          className="absolute top-0 left-0 right-0 z-50 bg-amber-600/95 text-white p-2 text-sm border-b border-amber-700 flex flex-wrap items-center gap-2 justify-between"
        >
          <span className="min-w-0 flex-1">{DISCONNECT_BANNER}</span>
          <button
            type="button"
            data-testid="terminal-reconnect-button"
            onClick={handleReconnect}
            disabled={reconnecting}
            className="shrink-0 rounded bg-white/20 px-3 py-1 font-medium hover:bg-white/30 disabled:opacity-60"
          >
            {reconnecting ? 'Reconnecting…' : 'Reconnect'}
          </button>
        </div>
      )}
      <div ref={containerRef} className="absolute inset-0 overflow-hidden p-2" />
    </div>
  );
}
