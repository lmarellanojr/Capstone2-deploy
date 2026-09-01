'use client';

import React, { useEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import {
  createSession,
  getSession,
  refit,
  sessionKey,
  type TermSession,
} from './terminalSessionManager';

interface XtermViewProps {
  podId: number;
  podType: 'kali' | 'meta' | 'dvwa';
  token: string;
}

export function XtermView({ podId, podType, token }: XtermViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const key = sessionKey(podId, podType);
    let session: TermSession | undefined = getSession(key);
    if (!session) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/api/ssh-websocket?token=${encodeURIComponent(
        token
      )}&pod_id=${podId}&pod_type=${podType}`;
      session = createSession(key, wsUrl);
    }
    session.onError = setError;

    // Attach the persistent terminal element into this container (re-attach on
    // navigation back preserves the full buffer + live connection).
    container.appendChild(session.host);
    const fitTimer = setTimeout(() => {
      refit(session!);
      session!.term.focus();
    }, 50);

    const onWindowResize = () => refit(session!);
    window.addEventListener('resize', onWindowResize);
    const ro = new ResizeObserver(() => refit(session!));
    ro.observe(container);

    return () => {
      clearTimeout(fitTimer);
      window.removeEventListener('resize', onWindowResize);
      ro.disconnect();
      session!.onError = undefined;
      // Detach but DO NOT dispose — the session lives on across navigation/tab switches.
      if (session!.host.parentNode === container) {
        container.removeChild(session!.host);
      }
    };
  }, [podId, podType, token]);

  return (
    // BUG-035: bounded positioning context; the terminal mount is absolute so it
    // can't drive layout height (FitAddon over-sized the page otherwise).
    <div className="relative w-full h-full overflow-hidden bg-black">
      {error && (
        <div className="absolute top-0 left-0 right-0 z-50 bg-red-600/95 text-white p-2 text-sm border-b border-red-700 flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="hover:text-white">&times;</button>
        </div>
      )}
      <div ref={containerRef} className="absolute inset-0 overflow-hidden p-2" />
    </div>
  );
}
