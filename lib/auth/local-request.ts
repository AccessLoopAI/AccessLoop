// Local sign-in hardening (docs/phase7-prompt.md T3 item 4; docs/decisions.md 2026-10-20), without editing the
// frozen lib/auth/local-session.ts. Its localAuthAllowed(host) trusts the Host header alone, so a tunnel or reverse
// proxy that rewrites Host to "localhost" (ngrok --host-header=rewrite, cloudflared, Caddy) would put "Sign in as
// the lead", and every original report behind it, on the internet. A proxy that ADDS forwarding headers announces
// itself in them, so local auth is also refused when:
//   - `X-Forwarded-Host` or a `Forwarded: host=` names any host that is not local, or
//   - `X-Forwarded-For`, `X-Real-IP` or a `Forwarded: for=` holds any address that is not loopback
//     (127.0.0.0/8, ::1, ::ffff:127.x.y.z); `unknown` and obfuscated names are not loopback.
// Checked on `next start` (Next 16.4): Next itself fills in X-Forwarded-Host (= the Host header), X-Forwarded-For
// (= the socket address, 127.0.0.1 behind local:serve's 127.0.0.1 listener), X-Forwarded-Proto and -Port when a
// request has none, and keeps any the client sent. So a plain local request passes, and anything a proxy adds
// is seen. LIMIT (review finding, docs/decisions.md 2026-10-21): a same-machine proxy that adds NO forwarding header
// (a plain nginx `proxy_pass` with `proxy_set_header Host localhost`, no X-Forwarded-For / X-Real-IP / Forwarded)
// connects from 127.0.0.1, so Next fills the headers in exactly as for a direct local request and this check can't
// tell them apart (the frozen local-session.ts never sees the socket). Local mode must never sit behind a reverse
// proxy or tunnel at all (SECURITY.md "Staff sign-in", README). Used by proxy.ts, the /sign-in page and action,
// getStaff(), the Expo web build's CORS and the claude-cli guard (lib/ai/context.ts). Pure: no Node-only imports.
import { localAuthAllowed } from "@/lib/auth/local-session";

export interface HeaderReader {
  get(name: string): string | null;
}

/** localAuthAllowed(Host) AND no forwarding header that points away from this computer. */
export function localRequestAllowed(headers: HeaderReader): boolean {
  if (!localAuthAllowed(headers.get("host"))) return false;
  const { hosts, addresses } = forwardingClaims(headers);
  return hosts.every((h) => localAuthAllowed(h)) && addresses.every(isLoopbackAddress);
}

/** Every host and client address the forwarding headers name (empty entries dropped). */
export function forwardingClaims(headers: HeaderReader): { hosts: string[]; addresses: string[] } {
  const hosts = list(headers.get("x-forwarded-host"));
  const addresses = [...list(headers.get("x-forwarded-for")), ...list(headers.get("x-real-ip"))];
  // RFC 7239: `Forwarded: for=192.0.2.60;proto=http;host=example.com, for="[2001:db8::1]:4711"`.
  for (const element of list(headers.get("forwarded"))) {
    for (const pair of element.split(";")) {
      const eq = pair.indexOf("=");
      if (eq < 0) continue;
      const key = pair.slice(0, eq).trim().toLowerCase();
      const value = unquote(pair.slice(eq + 1).trim());
      if (key === "host") hosts.push(value);
      else if (key === "for") addresses.push(value);
    }
  }
  return { hosts, addresses };
}

/** True only for a loopback IP literal, with or without a port or brackets. Anything else (names too) is false. */
export function isLoopbackAddress(raw: string): boolean {
  let a = unquote(raw.trim()).toLowerCase();
  if (a.startsWith("[")) {
    const end = a.indexOf("]");
    if (end < 0) return false;
    a = a.slice(1, end);
  } else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(a)) {
    a = a.slice(0, a.lastIndexOf(":"));
  }
  const v4 = a.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return v4.slice(1).every((o) => Number(o) <= 255) && Number(v4[1]) === 127;
  if (!a.includes(":") || !/^[0-9a-f:.%a-z]+$/.test(a)) return false;
  const host = ipv6Canonical(a.split("%")[0]);
  if (host === "::1") return true;
  // IPv4-mapped: the WHATWG serializer writes ::ffff:127.0.0.1 as ::ffff:7f00:1.
  const mapped = host?.match(/^::ffff:([0-9a-f]{1,4}):[0-9a-f]{1,4}$/);
  return !!mapped && parseInt(mapped[1], 16) >> 8 === 127;
}

function ipv6Canonical(a: string): string | null {
  try {
    const h = new URL(`http://[${a}]/`).hostname;
    return h.slice(1, -1);
  } catch {
    return null;
  }
}

function list(value: string | null): string[] {
  return (value ?? "").split(",").map((s) => s.trim()).filter((s) => s !== "");
}

function unquote(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}
