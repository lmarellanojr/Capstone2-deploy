declare module 'next-auth' {
  // AUTH-01: Keycloak realm roles (realm_access.roles), decoded server-side
  // in the jwt() callback (portal/src/lib/auth.ts) and mirrored here in the
  // session() callback. Client-side only -- the FastAPI backend never trusts
  // this value and re-derives roles itself from the bearer token it receives
  // (see provisioning/auth.py's require_role()).
  //
  // Deliberately string[], not a narrow union: the raw array always also
  // carries Keycloak-internal roles (offline_access, uma_authorization,
  // default-roles-<realm>) alongside the three app roles below, and callers
  // must tolerate roles this app doesn't know about without a type error.
  // Role is exported as a convenience for callers checking a known value
  // (e.g. `roles.includes(role satisfies Role)`), not as roles' own type.
  export type Role = "student" | "instructor" | "admin";

  export interface Session {
    accessToken?: string;
    error?: string;
    user?: {
      name?: string | null;
      email?: string | null;
      image?: string | null;
      roles?: string[];
    };
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
