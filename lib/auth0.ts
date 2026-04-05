import { Auth0Client } from "@auth0/nextjs-auth0/server";
import type { UserRole } from "@/types";

export const auth0 = new Auth0Client({
  routes: {
    login:    "/api/auth/login",
    logout:   "/api/auth/logout",
    callback: "/api/auth/callback",
  },
  async beforeSessionSaved(session) {
    // Auth0 v4 strips unrecognized claims by default.
    // Return session as-is so custom claims (e.g. https://rxmonitor.app/roles) are preserved.
    return session;
  },
});

/** Extract roles from Auth0 app_metadata claim */
export function getUserRoles(user: Record<string, unknown>): UserRole[] {
  const ns = "https://rxmonitor.app/roles";
  const roles = (user[ns] as UserRole[]) ?? [];
  return roles;
}

export function hasRole(user: Record<string, unknown>, role: UserRole): boolean {
  return getUserRoles(user).includes(role);
}

export function requireRole(user: Record<string, unknown> | null | undefined, role: UserRole): void {
  if (!user) throw new Error("Unauthenticated");
  if (!hasRole(user, role)) throw new Error(`Forbidden: requires ${role} role`);
}
