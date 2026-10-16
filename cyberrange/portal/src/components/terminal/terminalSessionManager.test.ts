/** @jest-environment jsdom */

const mockWrite = jest.fn();
const mockWriteln = jest.fn();
const mockDispose = jest.fn();
const mockFocus = jest.fn();
const mockFit = jest.fn();
const mockLoadAddon = jest.fn();
const mockOnData = jest.fn();
const mockAttachCustomKeyEventHandler = jest.fn();
const mockGetSelection = jest.fn(() => '');
const mockClearSelection = jest.fn();
const mockOpen = jest.fn();

jest.mock('@xterm/xterm', () => ({
  Terminal: jest.fn().mockImplementation(() => ({
    cols: 80,
    rows: 24,
    open: mockOpen,
    loadAddon: mockLoadAddon,
    onData: mockOnData,
    write: mockWrite,
    writeln: mockWriteln,
    dispose: mockDispose,
    focus: mockFocus,
    attachCustomKeyEventHandler: mockAttachCustomKeyEventHandler,
    getSelection: mockGetSelection,
    clearSelection: mockClearSelection,
  })),
}));

jest.mock('@xterm/addon-fit', () => ({
  FitAddon: jest.fn().mockImplementation(() => ({ fit: mockFit })),
}));

jest.mock('@xterm/addon-canvas', () => ({
  CanvasAddon: jest.fn().mockImplementation(() => ({})),
}));

type WsHandler = (() => void) | ((ev: { data: unknown }) => void) | null;

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  url: string;
  onopen: WsHandler = null;
  onclose: WsHandler = null;
  onerror: WsHandler = null;
  onmessage: WsHandler = null;
  send = jest.fn();
  close = jest.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    if (typeof this.onclose === 'function') this.onclose();
  });

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  static instances: MockWebSocket[] = [];

  static reset() {
    MockWebSocket.instances = [];
  }

  /** Simulate server/open handshake. */
  open() {
    this.readyState = MockWebSocket.OPEN;
    if (typeof this.onopen === 'function') this.onopen();
  }

  /** Simulate remote close without going through close(). */
  remoteClose() {
    this.readyState = MockWebSocket.CLOSED;
    if (typeof this.onclose === 'function') this.onclose();
  }
}

(global as any).WebSocket = MockWebSocket;

import {
  __resetSessionsForTests,
  createSession,
  destroySession,
  getSession,
  isSessionLive,
  sessionKey,
} from './terminalSessionManager';

describe('terminalSessionManager', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockWebSocket.reset();
    __resetSessionsForTests();
  });

  afterEach(() => {
    __resetSessionsForTests();
  });

  it('sessionKey joins podId and podType', () => {
    expect(sessionKey(42, 'kali')).toBe('42:kali');
    expect(sessionKey(7, 'meta')).toBe('7:meta');
  });

  it('createSession registers a live session', () => {
    const key = sessionKey(1, 'kali');
    const session = createSession(key, 'ws://test/api/ssh-websocket?token=abc&pod_id=1&pod_type=kali');
    expect(getSession(key)).toBe(session);
    expect(isSessionLive(key)).toBe(true);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain('token=abc');
    expect(MockWebSocket.instances[0].url).toContain('pod_type=kali');
  });

  it('WebSocket close removes the dead session so createSession can run again', () => {
    const key = sessionKey(2, 'meta');
    const onClose = jest.fn();
    const first = createSession(key, 'ws://test/meta-1');
    first.onClose = onClose;
    const ws = MockWebSocket.instances[0];

    ws.remoteClose();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(getSession(key)).toBeUndefined();
    expect(isSessionLive(key)).toBe(false);
    expect(mockWriteln).toHaveBeenCalledWith(
      expect.stringContaining('[Client] Connection closed.')
    );

    const second = createSession(key, 'ws://test/meta-2');
    expect(getSession(key)).toBe(second);
    expect(second).not.toBe(first);
    expect(MockWebSocket.instances).toHaveLength(2);
    expect(MockWebSocket.instances[1].url).toBe('ws://test/meta-2');
  });

  it('destroySession clears callbacks and does not invoke onClose UI', () => {
    const key = sessionKey(3, 'kali');
    const onClose = jest.fn();
    const onError = jest.fn();
    const session = createSession(key, 'ws://test/kali');
    session.onClose = onClose;
    session.onError = onError;

    destroySession(key);

    expect(getSession(key)).toBeUndefined();
    expect(onClose).not.toHaveBeenCalled();
    expect(MockWebSocket.instances[0].close).toHaveBeenCalled();
  });

  it('createSession replaces an existing key without leaking the old socket', () => {
    const key = sessionKey(4, 'dvwa');
    createSession(key, 'ws://test/old');
    const oldWs = MockWebSocket.instances[0];
    const next = createSession(key, 'ws://test/new');
    expect(getSession(key)).toBe(next);
    expect(oldWs.close).toHaveBeenCalled();
    expect(MockWebSocket.instances[1].url).toBe('ws://test/new');
  });

  it('isSessionLive is false after remote close', () => {
    const key = sessionKey(5, 'meta');
    createSession(key, 'ws://test/meta');
    expect(isSessionLive(key)).toBe(true);
    MockWebSocket.instances[0].remoteClose();
    expect(isSessionLive(key)).toBe(false);
  });

  it('onOpen fires when the socket opens', () => {
    const key = sessionKey(6, 'kali');
    const onOpen = jest.fn();
    const session = createSession(key, 'ws://test/kali');
    session.onOpen = onOpen;
    MockWebSocket.instances[0].open();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
