// What a location's poster prints (Phase 7 T4.5): the address its QR code opens, built from the configured public
// base URL (lib/app-url.ts), never from the Host header. Server-only by use.
import { appBaseUrl } from "@/lib/app-url";
import { posterPath } from "./input";

export interface PosterAddress {
  /** The absolute address the code opens, or null when no public base URL is configured. */
  url: string | null;
  /** True when that address only works on this computer (localhost): phones can't open it. */
  localOnly: boolean;
}

/** localhost, 127.0.0.1, [::1] and *.localhost: names only the computer itself answers. */
export function isLocalOnlyUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127\./.test(host);
  } catch {
    return true;
  }
}

export function posterAddress(orgSlug: string, locationId: string, base: string | null = appBaseUrl()): PosterAddress {
  if (!base) return { url: null, localOnly: false };
  const url = `${base.replace(/\/+$/, "")}${posterPath(orgSlug, locationId)}`;
  return { url, localOnly: isLocalOnlyUrl(url) };
}
