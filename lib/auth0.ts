import { Auth0Client } from "@auth0/nextjs-auth0/server";
import type { UserRole } from "@/types";

/**
 * Custom JWT claim namespace for the `roles` array. Must match the namespace configured
 * in Auth0 (Actions / Rules) — e.g. add to ID token: `https://policysync.app/roles`: app_metadata.roles
 */
export const AUTH0_ROLES_CLAIM = "https://policysync.app/roles";

export const auth0 = new Auth0Client({
  routes: {
    login:    "/api/auth/login",
    logout:   "/api/auth/logout",
    callback: "/api/auth/callback",
  },
  async beforeSessionSaved(session) {
    // Auth0 v4 strips unrecognized claims by default.
    // Return session as-is so custom claims (e.g. AUTH0_ROLES_CLAIM) are preserved.
    return session;
  },
});

/** Extract roles from Auth0 custom namespace claim */
export function getUserRoles(user: Record<string, unknown>): UserRole[] {
  const roles = (user[AUTH0_ROLES_CLAIM] as UserRole[]) ?? [];
  return roles;
}

export function hasRole(user: Record<string, unknown>, role: UserRole): boolean {
  return getUserRoles(user).includes(role);
}

export function requireRole(user: Record<string, unknown> | null | undefined, role: UserRole): void {
  if (!user) throw new Error("Unauthenticated");
  if (!hasRole(user, role)) throw new Error(`Forbidden: requires ${role} role`);
}
