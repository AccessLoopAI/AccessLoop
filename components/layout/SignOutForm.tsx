import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";

/**
 * The staff header's sign-out control: a plain POST form (works without JavaScript) to app/sign-out/route.ts.
 * Render it once per page (StaffShell's `signOut` slot): e2e expects exactly one button named "Sign out".
 */
export function SignOutForm() {
  return (
    <form method="post" action="/sign-out">
      <Button type="submit" variant="chrome" iconStart={<Icon icon={LogOut} />}>
        Sign out
      </Button>
    </form>
  );
}
