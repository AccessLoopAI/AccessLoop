import { redirect } from "next/navigation";
import { requireStaff, staffHome } from "@/lib/auth/staff";

// /app has no page of its own: send each role to its home (leads and auditors: the dashboard; owners: my work).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function AppIndex() {
  const staff = await requireStaff();
  redirect(staffHome(staff.role));
}
