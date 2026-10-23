// The plain-text download as an HTTP answer (server-only), shared by the staff route (/app/reports/[id]/text, any
// state) and the public one (/p/[orgSlug]/reports/[id]/text, published only). Export is refused while a sentence
// has no sources or is blocked (domain §7 step 5: "Export is blocked if any sentence lacks a citation").
import { absoluteUrl } from "@/lib/app-url";
import type { ReportRow } from "./access";
import { plainTextFilename, reportPlainText } from "./text";
import { exportBlockers } from "./validate";

const TEXT = { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" };

export function plainTextResponse(status: number, message: string): Response {
  return new Response(`${message}\n`, { status, headers: TEXT });
}

export function reportTextResponse(report: ReportRow): Response {
  if (exportBlockers(report.content).length > 0) {
    return plainTextResponse(409, "This report can't be downloaded: a sentence has no sources or did not pass the sentence checks.");
  }
  const body = reportPlainText({
    title: report.title,
    orgName: report.content.settings.orgName,
    content: report.content,
    snapshot: report.snapshot,
    areaText: report.areaText,
    consultationsText: report.consultationsText,
    manifestHash: report.manifestHash,
    signedOffAt: report.signedOffAt,
    publishedAt: report.publishedAt,
    verifyUrl: absoluteUrl(`/verify/${report.id}`),
  });
  return new Response(body, {
    status: 200,
    headers: { ...TEXT, "content-disposition": `attachment; filename="${plainTextFilename(report.title)}"` },
  });
}
