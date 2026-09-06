"""Cyber Range web-terminal bridge — control-plane (lxc exec) edition.

Replaces the Node ssh2-over-TCP bridge. Streams a PTY-wrapped `lxc exec` session
to the browser over the existing /api/ssh-websocket protocol. No network path to
pods — reaches them via the LXD control plane, exactly like the agentless
ssh_verifier/score_verifier. Runs on the LXD host as a systemd service.

Spec: the control-plane web-terminal bridge design (not packed into this repo;
the shipped contract is bridge-src/README.md plus this module).
"""
import os
import sys
import json
import base64
import signal
import struct
import logging
import asyncio
import urllib.parse
import urllib.request
import urllib.error
# NB: fcntl/termios/pty are Unix-only and imported lazily inside the PTY session
# so the pure helpers + auth stay importable (and unit-testable) on any platform.

logger = logging.getLogger("ssh_bridge")

# --- pure helpers (unit-tested without a live host) ---

POD_USERS = {"kali": "student", "dvwa": "student", "meta": "msfadmin"}
LXD_PROJECT = "default"


def container_name_for(pod_row: dict, pod_type: str) -> str:
    """Resolve the LXD container name from a /pods/<id>/status row (vmid_<type>)."""
    if pod_type not in POD_USERS:
        raise ValueError(f"unknown pod_type {pod_type!r}")
    name = pod_row.get(f"vmid_{pod_type}")
    if not name:
        raise ValueError(f"no container name for {pod_type} in pod row")
    return name


def launch_command_for(pod_type: str) -> list:
    """argv for `lxc exec`, with a literal '{container}' placeholder filled at spawn.
    Lands the role's user in a reattachable tmux 'lab' session (login-shell fallback)."""
    user = POD_USERS[pod_type]
    # TERM must be set or tmux fails "open terminal failed" (su - resets env, so set it
    # inside the -c script; the SSH bridge previously got this from the PTY term request).
    launch = ("export TERM=xterm-256color; "
              "command -v tmux >/dev/null && exec tmux new-session -A -s lab || exec bash -l")
    return ["lxc", "--project", LXD_PROJECT, "exec", "{container}", "-t",
            "--env", "TERM=xterm-256color",
            "--", "su", "-", user, "-c", launch]


def parse_client_message(msg: str):
    """('resize', rows, cols) for a well-formed resize control message, else ('data', msg).
    Malformed resize JSON is treated as keystrokes (never raises)."""
    if msg.startswith('{"type":"resize"'):
        try:
            p = json.loads(msg)
            return ("resize", int(p["rows"]), int(p["cols"]))
        except (ValueError, KeyError, TypeError):
            return ("data", msg)
    return ("data", msg)


# --- config (fail-closed) ---

class Config:
    def __init__(self, **k):
        self.__dict__.update(k)

    @staticmethod
    def from_env():
        auth_enabled = os.getenv("AUTH_ENABLED", "true") != "false"
        cfg = Config(
            auth_enabled=auth_enabled,
            keycloak_introspect_url=os.getenv("KEYCLOAK_INTROSPECT_URL"),
            keycloak_client_id=os.getenv("KEYCLOAK_CLIENT_ID"),
            keycloak_client_secret=os.getenv("KEYCLOAK_CLIENT_SECRET"),
            provision_api_url=os.getenv("PROVISION_API_URL"),
            bind_host=os.getenv("BRIDGE_BIND_HOST", "10.0.10.11"),
            bind_port=int(os.getenv("BRIDGE_BIND_PORT", "8765")),
        )
        if auth_enabled:
            for k in ("keycloak_introspect_url", "keycloak_client_id",
                      "keycloak_client_secret", "provision_api_url"):
                if not getattr(cfg, k):
                    sys.stderr.write(f"FATAL: required env for {k} is not set\n")
                    sys.exit(1)
        return cfg


CONFIG = None  # set in main()


# --- auth + ownership ---

async def _http_get_json(url: str, token: str):
    """Blocking urllib in a thread; returns (status, json_or_{})."""
    def _do():
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
        try:
            with urllib.request.urlopen(req, timeout=6) as r:
                return (r.status, json.loads(r.read().decode() or "{}"))
        except urllib.error.HTTPError as e:
            return (e.code, {})
        except Exception as e:
            logger.warning(f"ownership GET failed: {e}")
            return (0, {})
    return await asyncio.to_thread(_do)


async def _http_post_introspect(token: str):
    scripts_dir = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "..", "Phase 5", "scripts")
    )
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from introspect_cache import get_cached, store

    cached = get_cached(token)
    if cached is not None:
        return cached

    def _do():
        auth = base64.b64encode(
            f"{CONFIG.keycloak_client_id}:{CONFIG.keycloak_client_secret}".encode()).decode()
        data = urllib.parse.urlencode({"token": token}).encode()
        req = urllib.request.Request(
            CONFIG.keycloak_introspect_url, data=data,
            headers={"Content-Type": "application/x-www-form-urlencoded",
                     "Authorization": f"Basic {auth}"})
        try:
            with urllib.request.urlopen(req, timeout=6) as r:
                payload = json.loads(r.read().decode() or "{}")
                # INTROSPECT_DEBUG_20260805
                logger.warning(
                    "introspect response active=%s typ=%s azp=%s token_len=%s",
                    payload.get("active"), payload.get("typ"), payload.get("azp"), len(token),
                )
                return payload
        except Exception as e:
            logger.warning("introspect failed: %s token_len=%s", e, len(token))
            return None

    result = await asyncio.to_thread(_do)
    if result:
        store(token, result)
    return result


async def introspect(token: str):
    if not CONFIG.auth_enabled:
        return {"active": True, "preferred_username": "authdisabled"}
    claims = await _http_post_introspect(token)
    return claims if (claims and claims.get("active") is True) else None


async def check_ownership(pod_id: int, token: str):
    """200 from /pods/<id>/status == owner; returns the pod row (incl vmid_*) else None."""
    if not CONFIG.auth_enabled:
        return {"vmid_kali": "pod-dev-kali", "vmid_meta": "pod-dev-meta", "vmid_dvwa": "pod-dev-dvwa"}
    status, body = await _http_get_json(
        f"{CONFIG.provision_api_url}/pods/{pod_id}/status", token)
    return body if status == 200 else None


# --- PTY session over lxc exec ---

def _set_winsize(fd: int, rows: int, cols: int):
    import fcntl, termios  # Unix-only; lazy
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


# Live PTY sessions keyed by LXD container name.
_active_sessions = {}


async def _evict_existing_session(container: str):
    """Force-close any live session already attached to this container and
    wait briefly for its own teardown to actually clear the registry before
    returning, so the new session's registration below can't be clobbered by
    the old session's delayed cleanup running after it."""
    old = _active_sessions.get(container)
    if not old:
        return
    try:
        os.killpg(os.getpgid(old["proc"].pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        await old["ws"].close(1000)
    except Exception:
        pass
    for _ in range(20):  # up to ~1s
        if _active_sessions.get(container) is not old:
            return
        await asyncio.sleep(0.05)
    _active_sessions.pop(container, None)



async def run_pty_session(ws, container: str, pod_type: str):
    import pty  # Unix-only; lazy
    await _evict_existing_session(container)
    argv = [a.replace("{container}", container) for a in launch_command_for(pod_type)]
    master, slave = pty.openpty()
    _set_winsize(master, 24, 80)  # sane initial size; browser sends a resize on connect

    def _child_setctty():
        # Make the pty slave (fd 0 after dup2) the controlling terminal so the kernel
        # delivers SIGWINCH to `lxc exec` on resize -> it forwards the size into the pod.
        import fcntl as _f, termios as _t
        _f.ioctl(0, _t.TIOCSCTTY, 0)

    proc = await asyncio.create_subprocess_exec(
        *argv, stdin=slave, stdout=slave, stderr=slave,
        start_new_session=True,      # own session/process group (setsid)
        preexec_fn=_child_setctty,   # acquire controlling tty for SIGWINCH delivery
        env={**os.environ, "HOME": "/home/llms_admin"},
    )
    os.close(slave)
    loop = asyncio.get_running_loop()
    session_entry = {"ws": ws, "proc": proc}
    _active_sessions[container] = session_entry


    async def pty_to_ws():
        try:
            while True:
                data = await loop.run_in_executor(None, os.read, master, 65536)
                if not data:
                    break
                await ws.send(data.decode("utf-8", "replace"))
        except Exception:
            pass

    async def ws_to_pty():
        try:
            async for raw in ws:
                msg = raw if isinstance(raw, str) else raw.decode("utf-8", "replace")
                kind, *rest = parse_client_message(msg)
                if kind == "resize":
                    # KNOWN LIMITATION: sets our PTY master size + SIGWINCHes lxc exec,
                    # but lxc exec's dynamic resize forwarding into the pod's inner PTY
                    # does not currently track mid-session (terminal opens at 24x80 and
                    # functions; reflow on browser-resize is a follow-up). Shell I/O is
                    # unaffected. See run log 2026-06-22.
                    _set_winsize(master, rest[0], rest[1])
                    try:
                        os.killpg(os.getpgid(proc.pid), signal.SIGWINCH)
                    except (ProcessLookupError, PermissionError):
                        pass
                else:
                    os.write(master, rest[0].encode("utf-8"))
        except Exception:
            pass

    pump = asyncio.gather(pty_to_ws(), ws_to_pty())   # gather() returns a Future, not a coroutine
    proc_wait = asyncio.create_task(proc.wait())
    try:
        await asyncio.wait({pump, proc_wait}, return_when=asyncio.FIRST_COMPLETED)
    finally:
        pump.cancel()
    # Teardown: kill the exec process group, close fds, close ws
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        try:
            await asyncio.wait_for(proc.wait(), timeout=3)
        except asyncio.TimeoutError:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except ProcessLookupError:
        pass
    finally:
        try:
            os.close(master)
        except OSError:
            pass
        try:
            await ws.send("\r\n[Connection closed]\r\n")
        except Exception:
            pass
        try:
            await ws.close(1000)
        except Exception:
            pass
        # Only clear the registry if we're still the current session for this
        # container — an evicting newer session may have already replaced us.
        if _active_sessions.get(container) is session_entry:
            del _active_sessions[container]



# --- websocket server ---
# NB: `websockets` is imported lazily inside main() so the pure helpers + auth remain
# importable (and unit-testable) on machines without the package installed.



async def handler(ws, path=None):
    # Path/query resolution across websockets variants:
    #  - legacy serve calls handler(ws, path) and/or exposes ws.path (incl. query)
    #  - new asyncio serve calls handler(ws) with the request on ws.request.path
    try:
        # INTROSPECT_PATH_FIX_20260805 — websockets 12: request.path includes query
        if not path:
            reqo = getattr(ws, "request", None)
            path = (getattr(reqo, "path", None) if reqo is not None else None) or getattr(ws, "path", None) or ""
        q = urllib.parse.parse_qs(urllib.parse.urlparse(path).query)
        token = (q.get("token") or [None])[0]
        pod_id = (q.get("pod_id") or [None])[0]
        pod_type = (q.get("pod_type") or ["kali"])[0]
        logger.info(
            "ws connect",
            extra={"event": "ws_connect", "pod_id": pod_id, "detail": pod_type},
        )
        if not token or not pod_id or not str(pod_id).isdigit():
            await ws.send("Error: Missing or invalid token/pod_id\r\n")
            await ws.close(1008)
            return
        if pod_type not in POD_USERS:
            await ws.send(f"Error: Unknown pod type {pod_type}\r\n")
            await ws.close(1008)
            return

        claims = await introspect(token)
        if not claims:
            logger.warning(
                "auth introspect failed",
                extra={"event": "auth_failure", "pod_id": pod_id, "detail": "inactive_token"},
            )
            await ws.send("Error: Invalid or expired token\r\n")
            await ws.close(1008)
            return
        pod_row = await check_ownership(int(pod_id), token)
        if not pod_row:
            logger.warning(
                "ownership check failed",
                extra={"event": "auth_failure", "pod_id": pod_id, "detail": "not_owner"},
            )
            await ws.send("Error: Not authorized for this pod\r\n")
            await ws.close(1008)
            return
        try:
            container = container_name_for(pod_row, pod_type)
        except ValueError as e:
            await ws.send(f"Error: {e}\r\n")
            await ws.close(1011)
            return

        await ws.send(f"\r\n[term] Authenticated. Opening {pod_type} on pod {pod_id}...\r\n")
        await run_pty_session(ws, container, pod_type)
    except Exception as e:
        logger.error(
            "handler error",
            extra={"event": "handler_error", "detail": str(e)},
        )
        try:
            await ws.send("Error: Internal server error\r\n")
            await ws.close(1011)
        except Exception:
            pass


async def main():
    global CONFIG
    import websockets  # lazy: keeps helpers importable without the package
    scripts_dir = os.path.normpath(
        os.path.join(os.path.dirname(__file__), "..", "..", "Phase 5", "scripts")
    )
    if scripts_dir not in sys.path:
        sys.path.insert(0, scripts_dir)
    from logging_config import configure_logging

    configure_logging("ssh_bridge")
    if not websockets.__version__.startswith("12."):
        sys.stderr.write(f"FATAL: websockets 12.x required, got {websockets.__version__}\n")
        sys.exit(1)
    CONFIG = Config.from_env()
    if not CONFIG.auth_enabled:
        logger.warning("AUTH_ENABLED=false — ownership/introspection BYPASSED. DEV ONLY, never in production.")
    logger.info(f"web-terminal bridge listening on {CONFIG.bind_host}:{CONFIG.bind_port} (auth={CONFIG.auth_enabled})")
    async with websockets.serve(handler, CONFIG.bind_host, CONFIG.bind_port):
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
