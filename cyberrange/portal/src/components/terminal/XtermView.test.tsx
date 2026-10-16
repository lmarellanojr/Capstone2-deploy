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

import { RECONNECT_BACKOFF_MS, XtermView } from './XtermView';

function makeSession(key: string) {
  const host = document.createElement('div');
  return {
    key,
    term: { focus: jest.fn() },
    fit: { fit: jest.fn() },
    ws: { readyState: 1 },
    host,
    onError: undefined as ((msg: string | null) => void) | undefined,
    onClose: undefined as (() => void) | undefined,
    onOpen: undefined as (() => void) | undefined,
  };
}

describe('XtermView reconnect UX', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockIsSessionLive.mockReturnValue(false);
    mockGetSession.mockReturnValue(undefined);
    // jsdom ResizeObserver
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
      session.onClose?.();
    });

    const banner = screen.getByTestId('terminal-reconnect-banner');
    expect(banner).toHaveTextContent(/Reconnect or refresh the page first/i);
    expect(banner).toHaveTextContent(/If reconnect fails and the lab pod was destroyed/i);
    expect(banner).toHaveTextContent(/Start new session/i);
    // Must not claim users never need Start Lab / Start new session when pod is gone.
    expect(banner).not.toHaveTextContent(/never need/i);
    expect(screen.getByTestId('terminal-reconnect-button')).toHaveTextContent('Reconnect');
  });

  it('manual Reconnect destroys the dead session and creates a fresh meta session', () => {
    const first = makeSession('11:meta');
    const second = makeSession('11:meta');
    mockCreateSession.mockReturnValueOnce(first).mockReturnValueOnce(second);

    render(<XtermView podId={11} podType="meta" token="tok" />);

    act(() => {
      first.onClose?.();
    });

    fireEvent.click(screen.getByTestId('terminal-reconnect-button'));

    expect(mockDestroySession).toHaveBeenCalledWith('11:meta');
    expect(mockCreateSession).toHaveBeenCalledTimes(2);
    const reconnectUrl = mockCreateSession.mock.calls[1][1] as string;
    expect(reconnectUrl).toContain('pod_type=meta');
    expect(reconnectUrl).toContain('token=tok');
  });

  it('auto-reconnects with backoff after disconnect', () => {
    const first = makeSession('1:kali');
    const second = makeSession('1:kali');
    mockCreateSession.mockReturnValueOnce(first).mockReturnValueOnce(second);

    render(<XtermView podId={1} podType="kali" token="tok" />);

    act(() => {
      first.onClose?.();
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(1);

    act(() => {
      jest.advanceTimersByTime(RECONNECT_BACKOFF_MS[0]);
    });

    expect(mockCreateSession).toHaveBeenCalledTimes(2);
  });

  it('stops auto-reconnect after exhausting backoff attempts', () => {
    mockCreateSession.mockImplementation((key: string) => makeSession(key));

    render(<XtermView podId={2} podType="kali" token="tok" />);

    // Initial create
    expect(mockCreateSession).toHaveBeenCalledTimes(1);

    // Simulate repeated disconnects after each auto attempt.
    for (let i = 0; i < RECONNECT_BACKOFF_MS.length; i++) {
      const lastSession = mockCreateSession.mock.results[mockCreateSession.mock.results.length - 1]
        .value as ReturnType<typeof makeSession>;
      act(() => {
        lastSession.onClose?.();
      });
      act(() => {
        jest.advanceTimersByTime(RECONNECT_BACKOFF_MS[i]);
      });
    }

    const createsAfterBackoff = mockCreateSession.mock.calls.length;

    // One more disconnect should not schedule another auto create past the cap.
    const lastSession = mockCreateSession.mock.results[mockCreateSession.mock.results.length - 1]
      .value as ReturnType<typeof makeSession>;
    act(() => {
      lastSession.onClose?.();
    });
    act(() => {
      jest.advanceTimersByTime(10_000);
    });

    expect(mockCreateSession.mock.calls.length).toBe(createsAfterBackoff);
    expect(screen.getByTestId('terminal-reconnect-button')).toBeInTheDocument();
  });
});
