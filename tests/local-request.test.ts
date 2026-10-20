// lib/auth/local-request.ts: local sign-in refused through a proxy or tunnel (docs/decisions.md 2026-10-20).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forwardingClaims, isLoopbackAddress, localRequestAllowed } from "@/lib/auth/local-request";

const h = (o: Record<string, string>) => new Headers(o);

describe("isLoopbackAddress", () => {
  it.each(["127.0.0.1", "127.5.6.7", "127.255.255.254", "127.0.0.1:50123", "::1", "[::1]", "[::1]:443", "0:0:0:0:0:0:0:1", "::ffff:127.0.0.1", "[::ffff:127.9.9.9]:80", "::FFFF:7F00:1", '"[::1]:4711"'])(
    "%s is loopback",
    (a) => expect(isLoopbackAddress(a)).toBe(true),
  );
  it.each(["203.0.113.9", "10.0.0.1", "192.168.1.20", "2001:db8::1", "::ffff:10.0.0.1", "::", "::2", "unknown", "_hidden", "localhost", "", "127.0.0.256", "127.0.0", "1.2.3.4.5", "128.0.0.1", "[::1", "fe80::1%lo0"])(
    "%s is not loopback",
    (a) => expect(isLoopbackAddress(a)).toBe(false),
  );
});

describe("forwardingClaims", () => {
  it("collects hosts and addresses from every forwarding header, RFC 7239 included", () => {
    expect(
      forwardingClaims(
        h({
          "x-forwarded-host": "a.example, b.example",
          "x-forwarded-for": "203.0.113.9, 127.0.0.1",
          "x-real-ip": "198.51.100.4",
          forwarded: 'for=192.0.2.60;proto=http;by=203.0.113.43, for="[2001:db8:cafe::17]:4711";host="c.example"',
        }),
      ),
    ).toEqual({
      hosts: ["a.example", "b.example", "c.example"],
      addresses: ["203.0.113.9", "127.0.0.1", "198.51.100.4", "192.0.2.60", "[2001:db8:cafe::17]:4711"],
    });
    expect(forwardingClaims(h({}))).toEqual({ hosts: [], addresses: [] });
  });
});

describe("localRequestAllowed", () => {
  beforeEach(() => {
    vi.stubEnv("AUTH_MODE", "local");
    vi.stubEnv("VERCEL", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("allows a plain local request, and one carrying what `next start` itself adds", () => {
    expect(localRequestAllowed(h({ host: "localhost:3000" }))).toBe(true);
    // Next 16.4 fills these in when absent (checked on local:serve): X-Forwarded-Host = Host, -For = the socket.
    expect(localRequestAllowed(h({ host: "localhost:3101", "x-forwarded-host": "localhost:3101", "x-forwarded-for": "127.0.0.1", "x-forwarded-proto": "http", "x-forwarded-port": "3101" }))).toBe(true);
    expect(localRequestAllowed(h({ host: "[::1]:3000", "x-forwarded-for": "::1", forwarded: 'for="[::1]";host=localhost:3000' }))).toBe(true);
  });

  it("refuses a non-local Host, as localAuthAllowed does", () => {
    expect(localRequestAllowed(h({ host: "accessloop.example.com" }))).toBe(false);
    expect(localRequestAllowed(h({}))).toBe(false);
  });

  it("refuses Host: localhost when a forwarding header names another host", () => {
    expect(localRequestAllowed(h({ host: "localhost", "x-forwarded-host": "evil.example" }))).toBe(false);
    expect(localRequestAllowed(h({ host: "localhost", "x-forwarded-host": "localhost, evil.example" }))).toBe(false);
    expect(localRequestAllowed(h({ host: "localhost", forwarded: "host=evil.example" }))).toBe(false);
    expect(localRequestAllowed(h({ host: "localhost", forwarded: 'proto=https;host="abc.ngrok-free.app"' }))).toBe(false);
  });

  it("refuses Host: localhost when any forwarded client address is not loopback", () => {
    expect(localRequestAllowed(h({ host: "localhost", "x-forwarded-for": "203.0.113.9" }))).toBe(false);
    // A proxy APPENDS the real client: one non-loopback entry anywhere is enough.
    expect(localRequestAllowed(h({ host: "localhost", "x-forwarded-for": "127.0.0.1, 203.0.113.9" }))).toBe(false);
    expect(localRequestAllowed(h({ host: "localhost", "x-real-ip": "198.51.100.4" }))).toBe(false);
    expect(localRequestAllowed(h({ host: "localhost", forwarded: "for=203.0.113.9" }))).toBe(false);
    expect(localRequestAllowed(h({ host: "localhost", forwarded: "for=unknown" }))).toBe(false);
    expect(localRequestAllowed(h({ host: "localhost", "x-forwarded-for": "2001:db8::1" }))).toBe(false);
  });

  it("is off outside AUTH_MODE=local and on Vercel, whatever the headers", () => {
    vi.stubEnv("AUTH_MODE", "clerk");
    expect(localRequestAllowed(h({ host: "localhost:3000" }))).toBe(false);
    vi.stubEnv("AUTH_MODE", "local");
    vi.stubEnv("VERCEL", "1");
    expect(localRequestAllowed(h({ host: "localhost:3000" }))).toBe(false);
  });
});
