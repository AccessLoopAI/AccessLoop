// The signed root and the evidence bundle (docs/domain.md §8 "Signed at sign-off"; docs/phase7-prompt.md T5 items
// 1-3 and the footer half of item 5), against the local production build: the public key list at
// /.well-known/accessloop-signing-keys.json (public values only); a published report's "Download evidence bundle"
// (a JSON attachment; drafts and signed-off-but-unpublished reports 404) that a third party can check with nothing
// but node:crypto: the snapshot's fingerprint, the root over every case head + the fingerprint + the lead's text +
// the sentences, the Ed25519 signature with the published key, and the links of each cited case history; the signed
// fingerprint on the public page and, for the lead, in the staff report's footer with the ACR s.16 notice line.
// The pages' axe runs stay in e2e/reports.spec.ts (both themes, the same footers). Specs share one database.
import { createHash, createPublicKey, randomBytes, verify } from "node:crypto";
import { test, expect, type Browser } from "@playwright/test";
import { signInAs } from "./helpers";
import { makeReport } from "./fixtures/reports";

const ORG = "maple-harbour";
const KEYS = "/.well-known/accessloop-signing-keys.json";

test.describe.configure({ mode: "serial" });

/** A made-up loopback client address (127.x.y.z) per anonymous context: its own rate-limit bucket (IPv6 is counted per /64). */
const freshIp = () => ((b: Buffer) => `127.${1 + (b[0] % 255)}.${b[1]}.${b[2]}`)(randomBytes(3));
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The frozen lib/case-events.ts canonicalJson, rewritten as a third party would (sorted keys, no whitespace). */
function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}

async function anon(browser: Browser) {
  return (await browser.newContext({ extraHTTPHeaders: { "x-forwarded-for": freshIp() } })).newPage();
}

interface KeyList {
  issuer: string;
  keys: { keyId: string; algorithm: string; created: string | null; publicKey: string; jwk: Record<string, string> }[];
}

test("the public key list: key ID, algorithm, created and the key, never the private part", async ({ browser }) => {
  const page = await anon(browser);
  const res = await page.request.get(KEYS);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  expect(res.headers()["cache-control"]).toContain("max-age=");
  const text = await res.text();
  expect(text).not.toMatch(/"d"\s*:|PRIVATE/);
  const list = JSON.parse(text) as KeyList;
  expect(list.issuer).toBe("AccessLoop");
  expect(list.keys).toHaveLength(1);
  const [k] = list.keys;
  expect(k).toMatchObject({ algorithm: "Ed25519", jwk: { kty: "OKP", crv: "Ed25519", kid: k.keyId } });
  expect(k.keyId).toMatch(/^ed25519-[0-9a-f]{16}$/);
  // The key ID names the key: sha256 of the raw public key.
  const spki = createPublicKey({ key: Buffer.from(k.publicKey, "base64"), format: "der", type: "spki" });
  const raw = Buffer.from(spki.export({ format: "jwk" }).x!, "base64url");
  expect(`ed25519-${createHash("sha256").update(raw).digest("hex").slice(0, 16)}`).toBe(k.keyId);
  await page.context().close();
});

test("Download evidence bundle: a published report's evidence, checked with node:crypto alone", async ({ browser }) => {
  const report = await makeReport(ORG, { publish: true });
  const page = await anon(browser);

  // From the page: the footer shows the signed fingerprint and the download link.
  await page.goto(`/p/${ORG}/reports/${report.id}`);
  const link = page.getByRole("link", { name: "Download evidence bundle" });
  await expect(link).toHaveAttribute("href", `/p/${ORG}/reports/${report.id}/evidence.json`);
  await expect(link).toHaveAttribute("download", "");
  await expect(page.getByRole("link", { name: "AccessLoop’s published signing keys" })).toHaveAttribute("href", KEYS);
  const [download] = await Promise.all([page.waitForEvent("download"), link.click()]);
  expect(download.suggestedFilename()).toMatch(/^accessibility-progress-report-2026-version-\d+-evidence\.json$/);

  const res = await page.request.get(`/p/${ORG}/reports/${report.id}/evidence.json`, { headers: { "x-forwarded-for": freshIp() } });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("application/json");
  expect(res.headers()["content-disposition"]).toMatch(/^attachment; filename=".+-evidence\.json"$/);
  const b = JSON.parse(await res.text());
  expect(b).toMatchObject({ format: "accessloop-evidence-bundle", version: 1, org: { slug: ORG }, report: { id: report.id, title: report.title } });

  // 1. The report's fingerprint.
  expect(sha(canonical(b.report.snapshot))).toBe(b.report.manifestHash);
  // 2. The root, recomputed from the file.
  const sig = b.signature;
  expect(sig).toMatchObject({ alg: "Ed25519", rootKind: "accessloop.report-root", rootVersion: 1 });
  const root = sha(
    canonical({
      kind: sig.rootKind,
      version: sig.rootVersion,
      reportId: b.report.id,
      signedAt: sig.signedAt,
      heads: [...sig.heads].sort(),
      manifestHash: b.report.manifestHash,
      leadTextHash: sha(canonical({ areaText: b.report.areaText, consultationsText: b.report.consultationsText })),
      contentHash: sha(canonical(b.report.content)),
    }),
  );
  expect(root).toBe(sig.root);
  expect(sig.signedAt).toBe(b.report.signedOffAt);
  // 3. The signature, with the published key named by the bundle.
  const list = (await (await page.request.get(KEYS)).json()) as KeyList;
  const key = list.keys.find((k) => k.keyId === sig.keyId)!;
  expect(key).toBeTruthy();
  const pub = createPublicKey({ key: Buffer.from(key.publicKey, "base64"), format: "der", type: "spki" });
  expect(verify(null, Buffer.from(sig.root, "ascii"), pub, Buffer.from(sig.signature, "base64"))).toBe(true);
  expect(verify(null, Buffer.from(sha("something else"), "ascii"), pub, Buffer.from(sig.signature, "base64"))).toBe(false);
  // 4. Each cited history: unbroken links from the first record, the report's and the signed heads in it.
  expect(b.chains.length).toBeGreaterThan(0);
  for (const c of b.chains as { ref: string; reportHead: string; signedHead: string; events: { seq: number; hash: string; prevHash: string; type: string }[] }[]) {
    let prev = "0".repeat(64);
    c.events.forEach((e, i) => {
      expect(e.seq, c.ref).toBe(i + 1);
      expect(e.prevHash, c.ref).toBe(prev);
      prev = e.hash;
    });
    expect(c.events.map((e) => e.hash), c.ref).toContain(c.reportHead);
    expect(c.events.map((e) => e.hash), c.ref).toContain(c.signedHead);
    expect(sig.heads, c.ref).toContain(c.signedHead);
  }
  // Public-safe only: no payloads, actors or staff-internal record kinds by name.
  const raw = JSON.stringify(b);
  expect(raw).not.toMatch(/"payload"|"actorId"|"signedOffBy"|private_revealed|redaction_approved|note_added/);

  // The page shows the same signed fingerprint (screen readers get the full value).
  await expect(page.getByTestId("signed-fingerprint")).toContainText(sig.keyId);
  await expect(page.getByTestId("signed-fingerprint")).toContainText(sig.root);
  await page.context().close();

  // The lead's report page: the fingerprint to put in the ACR s.16 notice, in full.
  const staff = await (await browser.newContext()).newPage();
  await signInAs(staff, "E2E_LEAD_EMAIL");
  await staff.goto(`/app/reports/${report.id}`);
  const notice = staff.getByTestId("notice-fingerprint");
  await expect(notice).toContainText("Signed fingerprint for your notice to the Accessibility Commissioner (ACR s.16)");
  await expect(notice).toContainText(sig.root);
  await expect(notice).toContainText(sig.keyId);
  await expect(staff.getByText("Include the signed fingerprint shown at the end of the report.")).toBeVisible();
  // The plain-text export carries it too.
  const text = await (await staff.request.get(`/app/reports/${report.id}/text`)).text();
  expect(text).toContain(`Signed fingerprint (Ed25519, key ${sig.keyId}): ${sig.root}`);
  await staff.context().close();
});

test("no bundle for a draft or a report that is signed off but not published", async ({ browser }) => {
  const draft = await makeReport(ORG);
  const signed = await makeReport(ORG, { signOff: true });
  const page = await anon(browser);
  for (const id of [draft.id, signed.id, "not-a-report"]) {
    const res = await page.request.get(`/p/${ORG}/reports/${id}/evidence.json`, { headers: { "x-forwarded-for": freshIp() } });
    expect(res.status(), id).toBe(404);
  }
  await page.context().close();

  // The draft's lead sees where the fingerprint will appear; the signed-off one already has it.
  const staff = await (await browser.newContext()).newPage();
  await signInAs(staff, "E2E_LEAD_EMAIL");
  await staff.goto(`/app/reports/${draft.id}`);
  await expect(staff.getByTestId("notice-fingerprint")).toHaveCount(0);
  await expect(staff.getByText("When you sign off, the signed fingerprint for your notice to the Accessibility Commissioner appears here.")).toBeVisible();
  await staff.goto(`/app/reports/${signed.id}`);
  await expect(staff.getByTestId("notice-fingerprint")).toContainText(/[0-9a-f]{64}/);
  await staff.context().close();
});
