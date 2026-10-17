/** @jest-environment jsdom */

import React from 'react';
import '@testing-library/jest-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';

const mockCreateSession = jest.fn();
const mockDestroySession = jest.fn();
const mockGetSession = jest.fn();
const mockIsSessionLive = jest.fn();
const mockRefit = jest.fn();
const mockSessionKey = jest.fn((podId: number, podType: string) => `${podId}:${podType}`);

jest.mock('./terminalSessionManager', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  destroySession: (...args: unknown[]) => mockDestroySession(...args),
  getSession: (...args: unknown[]) => mockGetSession(...args),
  isSessionLive: (...args: unknown[]) => mockIsSessionLive(...args),
  refit: (...args: unknown[]) => mockRefit(...args),
  sessionKey: (...args: unknown[]) => mockSessionKey(...(args as [number, string])),
}));

jest.mock('@xterm/xterm/css/xterm.css', () => ({}));

import { READY_STABILITY_MS, RECONNECT_BACKOFF_MS, XtermView } from './XtermView';

function makeSession(key: string) {
  const host = document.createElement('div');
  return {
    key,
    term: { focus: jest.fn(), dispose: jest.fn() },
    fit: { fit: jest.fn() },
    ws: { readyState: 1 },
    host,
    lastServerError: undefined as string | undefined,
    onError: undefined as ((msg: string | null) => void) | undefined,
    onClose: undefined as ((code?: number) => void) | undefined,
    onOpen: undefined as (() => void) | undefined,
    onReady: undefined as (() => void) | undefined,
  };
}

describe('XtermView reconnect UX', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockIsSessionLive.mockReturnValue(false);
    mockGetSession.mockReturnValue(undefined);
    (global as any).ResizeObserver = class {
      observe() {}
      disconnect() {}
      unobserve() {}
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates a kali session on mount with the existing SSH token URL path', () => {
    const session = makeSession('9:kali');
    mockCreateSession.mockReturnValue(session);

    render(<XtermView podId={9} podType="kali" token="tok-kali" />);

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    const url = mockCreateSession.mock.calls[0][1] as string;
    expect(url).toContain('/api/ssh-websocket?token=tok-kali');
    expect(url).toContain('pod_id=9');
    expect(url).toContain('pod_type=kali');
    expect(screen.queryByTestId('terminal-reconnect-banner')).not.toBeInTheDocument();
  });

  it('shows reconnect banner with correct copy when the session closes', () => {
    const session = makeSession('3:meta');
    mockCreateSession.mockReturnValue(session);

    render(<XtermView podId={3} podType="meta" token="tok-meta" />);

    act(() => {
      session.onClose?.(1000);
    });

    const banner = screen.getByTestId('terminal-reconnect-banner');
    expect(banner).toHaveTextContent(/Reconnect or refresh the page first/i);
    expect(banner).toHaveTextContent(/If reconnect fails and the lab pod was destroyed/i);
    expect(banner).toHaveTextContent(/Start new session/i);
    expect(banner).not.toHaveTextContent(/never need/i);
    expect(screen.getByTestId('terminal-reconnect-button')).toHaveTextContent('Reconnect');
  });

  it('shows bridge Error line in the banner when present', () => {
    const session = makeSession('3:meta');
    session.lastServerError = 'Error: Invalid or expired token';
    mockCreateSession.mockReturnValue(session);

    render(<XtermView podId={3} podType="meta" token="tok-meta" />);

    act(() => {
      session.onClose?.(1008);
    });

    expect(screen.getByTestId('terminal-reconnect-banner')).toHaveTextContent(
      /Error: Invalid or expired token/i
    );
  });

  it('manual Reconnect destroys the dead session and creates a fresh meta session', () => {
    const first = makeSession('11:meta');
    const second = makeSession('11:meta');
    mockCreateSession.mockReturnValueOnce(first).mockReturnValueOnce(second);

    render(<XtermView podId={11} podType="meta" token="tok" />);

    act(() => {
      first.onClose?.(1000);
    });

    fireEvent.click(screen.getByTestId('terminal-reconnect-button'));

    expect(mockDestroySession).toHaveBeenCalledWith('11:meta');
    expect(mockCreateSession).toHaveBeenCalledTimes(2);
    const reconnectUrl = mockCreateSession.mock.calls[1][1] as string;
    expect(reconnectUrl).toContain('pod_type=meta');
    expect(reconnectUrl).toContain('token=tok');
  });

  it('auto-reconnects with backoff after a transient disconnect', () => {
    const first = makeSession('1:kali');
    const second = makeSession('1:kali');
    mockCreateSession.mockReturnValueOnce(first).mockReturnValueOnce(second);

    render(<XtermView podId={1} podType="kali" token="tok" />);

    act(() => {
      first.onClose?.(1000);
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(RECONNECT_BACKOFF_MS[0]);
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(2);
  });

  it('does not auto-reconnect on close code 1008 (auth failure)', () => {
    mockCreateSession.mockImplementation((key: string) => makeSession(key));

    render(<XtermView podId={2} podType="kali" token="tok" />);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);

    const first = mockCreateSession.mock.results[0].value as ReturnType<typeof makeSession>;
    act(() => {
      first.onClose?.(1008);
    });
    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('terminal-reconnect-button')).toBeInTheDocument();
  });

  it('does not auto-reconnect on close code 1011 (missing container)', () => {
    mockCreateSession.mockImplementation((key: string) => makeSession(key));

    render(<XtermView podId={2} podType="meta" token="tok" />);
    const first = mockCreateSession.mock.results[0].value as ReturnType<typeof makeSession>;
    act(() => {
      first.onClose?.(1011);
    });
    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);
  });

  it('stops auto-reconnect after open→close loops without onReady (backoff cap)', () => {
    mockCreateSession.mockImplementation((key: string) => makeSession(key));

    render(<XtermView podId={2} podType="kali" token="tok" />);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);

    // Simulate bridge accept-then-reject: open handshake then close, without Authenticated.
    for (let i = 0; i < RECONNECT_BACKOFF_MS.length; i++) {
      const lastSession = mockCreateSession.mock.results[mockCreateSession.mock.results.length - 1]
        .value as ReturnType<typeof makeSession>;
      act(() => {
        lastSession.onOpen?.();
        lastSession.onClose?.(1000);
      });
      act(() => {
        jest.advanceTimersByTime(RECONNECT_BACKOFF_MS[i]);
      });
    }

    const createsAfterBackoff = mockCreateSession.mock.calls.length;
    expect(createsAfterBackoff).toBe(1 + RECONNECT_BACKOFF_MS.length);

    const lastSession = mockCreateSession.mock.results[mockCreateSession.mock.results.length - 1]
      .value as ReturnType<typeof makeSession>;
    act(() => {
      lastSession.onOpen?.();
      lastSession.onClose?.(1000);
    });
    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(mockCreateSession.mock.calls.length).toBe(createsAfterBackoff);
    expect(screen.getByTestId('terminal-reconnect-button')).toBeInTheDocument();
  });

  it('Authenticated→immediate close(1000) does not reset backoff (two-tab eviction)', () => {
    mockCreateSession.mockImplementation((key: string) => makeSession(key));

    render(<XtermView podId={8} podType="kali" token="tok" />);
    expect(mockCreateSession).toHaveBeenCalledTimes(1);

    for (let i = 0; i < RECONNECT_BACKOFF_MS.length; i++) {
      const lastSession = mockCreateSession.mock.results[mockCreateSession.mock.results.length - 1]
        .value as ReturnType<typeof makeSession>;
      act(() => {
        lastSession.onReady?.();
        lastSession.onClose?.(1000);
      });
      act(() => {
        jest.advanceTimersByTime(RECONNECT_BACKOFF_MS[i]);
      });
    }

    const createsAfterBackoff = mockCreateSession.mock.calls.length;
    expect(createsAfterBackoff).toBe(1 + RECONNECT_BACKOFF_MS.length);

    const lastSession = mockCreateSession.mock.results[mockCreateSession.mock.results.length - 1]
      .value as ReturnType<typeof makeSession>;
    act(() => {
      lastSession.onReady?.();
      lastSession.onClose?.(1000);
    });
    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(mockCreateSession.mock.calls.length).toBe(createsAfterBackoff);
  });

  it('stable onReady (after READY_STABILITY_MS) resets backoff for a later disconnect', () => {
    mockCreateSession.mockImplementation((key: string) => makeSession(key));

    render(<XtermView podId={8} podType="kali" token="tok" />);
    const first = mockCreateSession.mock.results[0].value as ReturnType<typeof makeSession>;

    // Exhaust backoff once without stability.
    for (let i = 0; i < RECONNECT_BACKOFF_MS.length; i++) {
      const lastSession = mockCreateSession.mock.results[mockCreateSession.mock.results.length - 1]
        .value as ReturnType<typeof makeSession>;
      act(() => {
        lastSession.onClose?.(1000);
      });
      act(() => {
        jest.advanceTimersByTime(RECONNECT_BACKOFF_MS[i]);
      });
    }

    const afterExhaust = mockCreateSession.mock.calls.length;
    const exhausted = mockCreateSession.mock.results[mockCreateSession.mock.results.length - 1]
      .value as ReturnType<typeof makeSession>;

    act(() => {
      exhausted.onReady?.();
    });
    act(() => {
      jest.advanceTimersByTime(READY_STABILITY_MS);
    });
    act(() => {
      exhausted.onClose?.(1000);
    });
    act(() => {
      jest.advanceTimersByTime(RECONNECT_BACKOFF_MS[0]);
    });

    expect(mockCreateSession.mock.calls.length).toBe(afterExhaust + 1);
  });

  it('clears the refit timer on unmount', () => {
    const session = makeSession('5:kali');
    mockCreateSession.mockReturnValue(session);
    const clearSpy = jest.spyOn(global, 'clearTimeout');

    const { unmount } = render(<XtermView podId={5} podType="kali" token="tok" />);
    unmount();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });

  it('disposes a retired session on unmount when it is no longer in the Map', () => {
    const session = makeSession('6:kali');
    mockCreateSession.mockReturnValue(session);
    // After close the manager retires the entry — getSession returns undefined.
    mockGetSession.mockReturnValue(undefined);

    const { unmount } = render(<XtermView podId={6} podType="kali" token="tok" />);
    act(() => {
      session.onClose?.(1000);
    });
    unmount();

    expect(session.term.dispose).toHaveBeenCalled();
  });
});
