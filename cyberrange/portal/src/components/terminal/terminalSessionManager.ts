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
  /** Fired on remote/local socket close with the WebSocket close code when available. */
  onClose?: (code?: number) => void;
  /** Fired when the socket upgrades (handshake). Does not mean the bridge accepted the session. */
  onOpen?: () => void;
  /** Fired when the bridge confirms auth (`[term] Authenticated…`). Safe to reset reconnect backoff. */
  onReady?: () => void;
  /** Last bridge/server `Error: …` line seen on this socket (if any). */
  lastServerError?: string;
  /** True after the bridge sent `[term] Authenticated…` on this socket. */
  bridgeReady?: boolean;
}

const sessions = new Map<string, TermSession>();

/** Bridge errors are their own ws.send line; do not match mid-chunk shell noise. */
const BRIDGE_ERROR_RE = /^\s*Error: [^\r\n]*/i;
/** After auth, only this bridge catch-all is still recorded (shell `Error:` lines are ignored). */
const BRIDGE_POST_AUTH_ERROR_RE = /^\s*Error: Internal server error\b/i;
const BRIDGE_AUTH_RE = /\[term\]\s*Authenticated/i;

export function sessionKey(podId: number, podType: string): string {
  return `${podId}:${podType}`;
}

export function getSession(key: string): TermSession | undefined {
  return sessions.get(key);
}

/** True when a session exists and its WebSocket is still connecting or open. */
export function isSessionLive(key: string): boolean {
  const s = sessions.get(key);
  if (!s) return false;
  return s.ws.readyState === WebSocket.CONNECTING || s.ws.readyState === WebSocket.OPEN;
}

function disposeSessionResources(session: TermSession): void {
  try { session.term.dispose(); } catch { /* noop */ }
  try { session.host.remove(); } catch { /* noop */ }
}

/**
 * Drop the Map entry so a new createSession can run, but keep the xterm host
 * attached until the UI replaces it — preserves scrollback and bridge Error lines.
 */
function retireSessionKeepTerminal(session: TermSession): void {
  if (sessions.get(session.key) !== session) return;
  sessions.delete(session.key);
}

function noteServerError(session: TermSession, text: string): void {
  if (session.bridgeReady) {
    const post = text.match(BRIDGE_POST_AUTH_ERROR_RE);
    if (post) session.lastServerError = post[0].trim();
    return;
  }
  const match = text.match(BRIDGE_ERROR_RE);
  if (match) session.lastServerError = match[0].trim();
}

export function createSession(key: string, wsUrl: string): TermSession {
  // Reconnect / replace must not leave a prior socket or xterm instance alive.
  if (sessions.has(key)) {
    destroySession(key);
  }

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
    const keyName = e.key.toLowerCase();
    if (keyName === 'c') {
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
    session.onOpen?.();
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      }
    }, 500);
  };

  ws.onmessage = (event) => {
    if (typeof event.data === 'string') {
      noteServerError(session, event.data);
      if (BRIDGE_AUTH_RE.test(event.data)) {
        session.bridgeReady = true;
        session.onReady?.();
      }
      term.write(event.data);
    } else {
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        noteServerError(session, text);
        if (BRIDGE_AUTH_RE.test(text)) {
          session.bridgeReady = true;
          session.onReady?.();
        }
        term.write(text);
      };
      reader.readAsText(event.data);
    }
  };

  ws.onclose = (ev?: CloseEvent) => {
    // Intentional destroySession already removed this entry and cleared callbacks.
    if (sessions.get(key) !== session) return;
    term.writeln('\r\n\x1b[31m[Client] Connection closed.\x1b[0m');
    const code = typeof ev?.code === 'number' ? ev.code : undefined;
    const onClose = session.onClose;
    retireSessionKeepTerminal(session);
    if (onClose) {
      // UI is attached — keep terminal/scrollback until replacement or unmount dispose.
      onClose(code);
    } else {
      // No UI listener (tab hidden / callbacks cleared) — dispose immediately.
      disposeSessionResources(session);
    }
  };

  ws.onerror = () => {
    if (sessions.get(key) !== session) return;
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
  // Clear UI callbacks before close so intentional teardown does not trigger reconnect UX.
  s.onClose = undefined;
  s.onError = undefined;
  s.onOpen = undefined;
  s.onReady = undefined;
  sessions.delete(key);
  try { s.ws.close(); } catch { /* noop */ }
  disposeSessionResources(s);
}

/** Test-only: clear the in-memory session map. */
export function __resetSessionsForTests(): void {
  for (const key of [...sessions.keys()]) {
    destroySession(key);
  }
}
