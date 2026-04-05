"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { UserCircle, LogOut, LogIn } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import type { UserRole } from "@/types";

interface AppNavProps {
  roles: UserRole[];
  userName: string | null;
  isAuthenticated: boolean;
}

export function AppNav({ roles, userName, isAuthenticated }: AppNavProps) {
  const pathname = usePathname();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isAdmin = roles.includes("admin");

  const navItems = [
    { href: "/admin", label: "Monitoring", show: isAdmin },
    { href: "/review", label: "Review queue", show: isAdmin },
    { href: "/search", label: "ISearch", show: isAuthenticated },
    { href: "/changelog", label: "Policy changes", show: isAuthenticated },
  ].filter((item) => item.show);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <nav
      className="fixed top-0 w-full z-50 shadow-sm"
      style={{
        background: "rgba(247,250,252,0.85)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
      }}
    >
      <div className="flex items-center justify-between px-8 py-4 max-w-[1440px] mx-auto">
        {/* Logo + Nav */}
        <div className="flex items-center gap-12">
          <Link
            href="/"
            className="text-xl font-extrabold tracking-tight"
            style={{ fontFamily: "Manrope, sans-serif", color: "#181c1e" }}
          >
            PolicySync
          </Link>

          <div className="flex items-center gap-8">
            {navItems.map(({ href, label }) => {
              const active =
                pathname === href || pathname.startsWith(href + "/");
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "text-sm font-semibold tracking-tight pb-1 transition-colors duration-200",
                    active
                      ? "text-[#00478d]"
                      : "text-slate-500 hover:text-slate-900"
                  )}
                  style={{
                    fontFamily: "Manrope, sans-serif",
                    borderBottom: active
                      ? "2px solid #00478d"
                      : "2px solid transparent",
                  }}
                >
                  {label}
                </Link>
              );
            })}
          </div>
        </div>

        {/* Right */}
        <div className="flex items-center gap-4">
          {isAuthenticated ? (
            <>
              {/* User menu */}
              <div className="relative" ref={menuRef}>
                <button
                  className="flex items-center gap-2 pl-3 border-l border-slate-200 hover:opacity-80 transition-opacity"
                  onClick={() => setUserMenuOpen((v) => !v)}
                >
                  <UserCircle className="h-5 w-5 text-slate-600" />
                  <span className="text-xs font-bold text-slate-700 hidden sm:block max-w-[120px] truncate">
                    {userName ?? "Clinical Admin"}
                  </span>
                </button>

                {userMenuOpen && (
                  <div
                    className="absolute right-0 mt-2 w-48 rounded-xl shadow-lg py-1 z-50"
                    style={{ backgroundColor: "white", boxShadow: "0px 12px 32px -4px rgba(24,28,30,0.12)" }}
                  >
                    <div className="px-4 py-2 border-b border-slate-100">
                      <p className="text-xs font-bold text-slate-900 truncate">
                        {userName ?? "Clinical Admin"}
                      </p>
                      <p className="text-xs text-slate-400 capitalize mt-0.5">
                        {roles.join(", ") || "viewer"}
                      </p>
                    </div>
                    <Link
                      href="/api/auth/logout"
                      className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                      onClick={() => setUserMenuOpen(false)}
                    >
                      <LogOut className="h-4 w-4 text-slate-400" />
                      Sign Out
                    </Link>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Link
              href="/api/auth/login"
              className="flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-lg transition-colors hover:bg-slate-100"
              style={{ color: "#00478d" }}
            >
              <LogIn className="h-4 w-4" />
              Sign In
            </Link>
          )}
        </div>
      </div>
    </nav>
  );
}
