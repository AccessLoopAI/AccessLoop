// The offline checker for an evidence bundle (tools/verify-bundle.mjs, docs/domain.md §8 "Signed at sign-off"), as a
// download: the exact one-file script this copy of AccessLoop ships, so anyone holding a bundle can read it and run
// it offline with Node.js alone. It is also in AccessLoop's source code. Read at BUILD time (force-static), so the
// deployed route never touches the file system. Public, no data: nothing to rate-limit.
import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-static";

export async function GET() {
  const script = await readFile(path.join(process.cwd(), "tools", "verify-bundle.mjs"), "utf8");
  return new Response(script, {
    status: 200,
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "content-disposition": 'attachment; filename="verify-bundle.mjs"',
      "x-content-type-options": "nosniff",
      "cache-control": "public, max-age=300",
    },
  });
}
