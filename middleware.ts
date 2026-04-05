import { NextRequest, NextResponse } from "next/server";
import { auth0 } from "@/lib/auth0";
import type { UserRole } from "@/types";

const ROLE_NAMESPACE = "https://rxmonitor.app/roles";

/** Routes and the minimum role required to access them */
const PROTECTED_ROUTES: Array<{ pattern: RegExp; role: UserRole }> = [
  { pattern: /^\/admin/, role: "admin" },
  { pattern: /^\/review/, role: "admin" },
  { pattern: /^\/api\/sources/, role: "admin" },
  { pattern: /^\/api\/fetch-check/, role: "admin" },
  { pattern: /^\/api\/extract/, role: "admin" },
  { pattern: /^\/api\/publish/, role: "admin" },
  { pattern: /^\/api\/audit/, role: "admin" },
];

/** Role hierarchy: admin can do everything viewer can */
const ROLE_LEVEL: Record<UserRole, number> = { viewer: 1, reviewer: 2, admin: 3 };

function meetsRole(userRoles: UserRole[], required: UserRole): boolean {
  return userRoles.some((r) => ROLE_LEVEL[r] >= ROLE_LEVEL[required]);
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public routes
  if (
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/search") ||
    pathname.startsWith("/api/qa") ||
    pathname.startsWith("/api/changelog") ||
    pathname === "/api/health" ||
    pathname === "/" ||
    pathname === "/search" ||
    pathname === "/changelog" ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // Cron routes: validate CRON_SECRET header instead of user session
  if (pathname === "/api/fetch-check" && req.method === "GET") {
    const cronSecret = req.headers.get("x-cron-secret");
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  try {
    const session = await auth0.getSession(req);
    if (!session?.user) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/api/auth/login", req.url));
    }

    const userRoles: UserRole[] = (session.user[ROLE_NAMESPACE] as UserRole[]) ?? [];

    // Check if route requires a specific role
    const routeGuard = PROTECTED_ROUTES.find(({ pattern }) => pattern.test(pathname));
    if (routeGuard && !meetsRole(userRoles, routeGuard.role)) {
      // API routes return 403; page routes redirect to root
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      return NextResponse.redirect(new URL("/", req.url));
    }

    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/api/auth/login", req.url));
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
