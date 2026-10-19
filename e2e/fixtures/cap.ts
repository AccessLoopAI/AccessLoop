// E2E-only fixture (never imported by the app): fills one org's daily cap on web reports for today
// (lib/rate-limit.ts, ORG_DAILY_SUBMISSION_LIMIT; docs/domain.md §9), through the app role and the same counter row
// the form counts in, and gives back a function that puts the count back as it was. Only for an org no other spec
// sends web reports to (the scenario org, Kestrel Bay), so a filled cap never refuses another spec's report.
import { orgDailyLimit, orgDayKey, zonedDayStart } from "@/lib/rate-limit";
import { appSql, orgId, withSql } from "../db";

export async function fillOrgCap(slug: string): Promise<{ limit: number; restore: () => Promise<void> }> {
  return withSql(appSql, async (sql) => {
    const id = await orgId(sql, slug);
    const key = orgDayKey(id);
    const start = zonedDayStart(new Date());
    const limit = orgDailyLimit(process.env);
    const [before] = await sql<{ count: number }[]>`select count from rate_limits where key = ${key} and window_start = ${start}`;
    const prior = before?.count ?? 0;
    await sql`
      insert into rate_limits (key, window_start, count) values (${key}, ${start}, ${limit})
      on conflict (key, window_start) do update set count = ${limit}`;
    const restore = () =>
      withSql(appSql, async (s) => {
        await s`update rate_limits set count = ${prior} where key = ${key} and window_start = ${start}`;
      });
    return { limit, restore };
  });
}
