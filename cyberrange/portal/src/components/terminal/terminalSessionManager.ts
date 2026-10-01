'use client';

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

export interface TermSession {
  key: string;
  term: any;
  fit: FitAddon;
  ws: WebSocket;
  host: HTMLDivElement; // persistent; term.open(host) called once
  onError?: (msg: string | null) => void;
}

const sessions = new Map<string, TermSession>();

export function sessionKey(podId: number, podType: string): string {
  return `${podId}:${podType}`;
}

export function getSession(key: string): TermSession | undefined {
  return sessions.get(key);
}

export function createSession(key: string, wsUrl: string): TermSession {
  const term: any = new Terminal({
    cursorBlink: true,
    theme: { background: '#000000', foreground: '#ffffff' },
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    fontSize: 14,
    scrollback: 1000,
    smoothScrollDuration: 0,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);

  const host = document.createElement('div');
  host.style.width = '100%';
  host.style.height = '100%';
  term.open(host);
  // Required lazily (not a static top-level import): @xterm/addon-canvas
  // touches `self` the instant it's loaded, and this module still gets
  // evaluated during Next.js's server-side render of the client component
  // that calls createSession() — a static import crashed every page with a
  // terminal (`ReferenceError: self is not defined`). createSession() itself
  // only ever runs in the browser, so requiring it here is safe.
  const { CanvasAddon } = require('@xterm/addon-canvas');
  term.loadAddon(new CanvasAddon());

  const ws = new WebSocket(wsUrl);
  const session: TermSession = { key, term, fit, ws, host };

  // COPY FIX (SIEM-breaks-terminal bug): copy the xterm selection explicitly so
  // it works regardless of focus history. TerminalView re-focuses the terminal
  // when an overlay (SIEM) closes, which is what makes paste work again.
  //   - Ctrl/Cmd+Shift+C : copy selection
  //   - Ctrl/Cmd+C       : copy selection if one exists, else pass through (SIGINT)
  // Paste is deliberately NOT intercepted: the browser's native paste event
  // already feeds xterm. Handling Ctrl/Cmd+V here as well sent every paste
  // twice ("run" arrived as "runrun").
  const writeClip = (text: string) => {
    try { navigator.clipboard?.writeText(text); } catch { /* clipboard blocked */ }
  };
  term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
    if (e.type !== 'keydown') return true;
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return true;
    const key = e.key.toLowerCase();
    if (key === 'c') {
      const sel = term.getSelection();
      if (e.shiftKey) {
        if (sel) writeClip(sel);
        return false; // Ctrl+Shift+C never reaches the shell
      }
      // Plain Ctrl+C: copy only when text is selected, else let it be SIGINT.
      if (sel && sel.length > 0) { writeClip(sel); term.clearSelection(); return false; }
      return true;
    }
    return true;
  });

  ws.onopen = () => {
    term.writeln('\x1b[32m[Client] Connecting to SSH proxy...\x1b[0m');
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    }, 500);
  };

  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      term.write(event.data);
    } else {
      const reader = new FileReader();
      reader.onload = () => term.write(reader.result as string);
      reader.readAsText(event.data);
    }
  };

  ws.onclose = () => {
    term.writeln('\r\n\x1b[31m[Client] Connection closed.\x1b[0m');
  };

  ws.onerror = () => {
    session.onError?.('WebSocket connection error.');
    term.writeln('\r\n\x1b[31m[Client] WebSocket error.\x1b[0m');
  };

  term.onData((data: string) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  });

  sessions.set(key, session);
  return session;
}

/** Focus a live terminal session by key (no-op if it isn't open). Used to return
 *  keyboard focus to the shell after an overlay (SIEM modal, info modal) closes,
 *  so the terminal stays usable and paste works without a manual click. */
export function focusSession(key: string): void {
  const s = sessions.get(key);
  if (!s) return;
  try { s.term.focus(); } catch { /* not attached yet */ }
}

export function refit(session: TermSession): void {
  try {
    session.fit.fit();
    if (session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(
        JSON.stringify({ type: 'resize', cols: session.term.cols, rows: session.term.rows })
      );
    }
  } catch {
    // container not measurable yet; ignore
  }
}

export function destroySession(key: string): void {
  const s = sessions.get(key);
  if (!s) return;
  try { s.ws.close(); } catch { /* noop */ }
  try { s.term.dispose(); } catch { /* noop */ }
  try { s.host.remove(); } catch { /* noop */ }
  sessions.delete(key);
}
