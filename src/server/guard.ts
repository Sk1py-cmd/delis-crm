import { redirect } from "next/navigation";
import { getSessionUser } from "./auth";
import { canAccess, defaultRouteForRole } from "@/shared/config/access";

/** Server-side route protection. Navigation visibility is never treated as authorization. */
export async function requireAccess(href: string) {
  const user = await getSessionUser();
  if (!user) redirect("/");
  if (!canAccess(user.role, href)) {
    redirect(defaultRouteForRole(user.role));
  }
  return user;
}
