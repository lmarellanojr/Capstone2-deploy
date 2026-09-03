declare module 'next-auth' {
  export interface Session {
    accessToken?: string;
    error?: string;
  }
  export interface NextAuthOptions {
    // Accept any options; customize as needed
    [key: string]: any;
  }
  export default function NextAuth(options: NextAuthOptions): any;
  export function getServerSession(authOptions: NextAuthOptions): any;
}

declare module 'next-auth/react' {
  export const useSession: any;
}
declare module 'next-auth/jwt' {
  export type JWT = any;
  export function getToken(options?: any): any;
}
declare module '@xterm/xterm' {
  export interface ITerminalOptions {
    cursorBlink?: boolean;
    theme?: { background?: string; foreground?: string };
    fontFamily?: string;
    fontSize?: number;
    scrollback?: number;
    smoothScrollDuration?: number;
    windowsMode?: boolean;
  }
  export class Terminal {
    constructor(options?: ITerminalOptions);
    cols: number;
    rows: number;
    open(host: HTMLElement): void;
    loadAddon(addon: any): void;
    onScroll(cb: () => void): void;
    onData(cb: (data: string) => void): void;
    write(data: string): void;
    writeln(data: string): void;
    refresh(start: number, end: number): void;
    dispose(): void;
  }
}

declare module '@xterm/addon-fit' {
  export class FitAddon {
    fit(): void;
  }
}
declare module 'next-auth/providers/credentials' {
  const CredentialsProvider: (options?: any) => any;
  export default CredentialsProvider;
}
