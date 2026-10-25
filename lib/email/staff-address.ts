// Where an email to a staff member goes (the daily job's owner alerts, app/api/cron/daily). Server-only.
//
// org_members holds no email address: in AUTH_MODE=local the seeded staff have none at all, and at Going live the
// address belongs to Clerk (the member's primary email, looked up by org_members.clerk_user_id). Until the Clerk
// adapter exists (Wave 2) there is no address to give, so this answers null. The job then still records the alert
// in the Outbox when FAKE_EMAIL=1 (nothing leaves the machine, so no address is needed), and with real email it sends
// nothing and counts the alert as "no address" in its answer. It never guesses an address.
export interface StaffMemberRef {
  orgId: string;
  memberId: string;
  /** org_members.clerk_user_id ("local_..." in the local prototype). */
  clerkUserId: string;
}

/** The staff member's email address, or null when none is known. Never logged. */
export async function staffEmailAddress(member: StaffMemberRef): Promise<string | null> {
  void member; // Wave 2: the Clerk user's primary email address.
  return null;
}
