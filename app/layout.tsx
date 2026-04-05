import type { Metadata } from "next";
import { Inter, Manrope } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { AppNav } from "@/components/layout/app-nav";
import { auth0, AUTH0_ROLES_CLAIM } from "@/lib/auth0";
import type { UserRole } from "@/types";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const manrope = Manrope({ subsets: ["latin"], variable: "--font-manrope" });

export const metadata: Metadata = {
  title: "PolicySync | Clinical Policy Intelligence",
  description: "Monitor, extract, and govern medical benefit drug policies across all plan types",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let roles: UserRole[] = [];
  let userName: string | null = null;
  let isAuthenticated = false;

  try {
    const session = await auth0.getSession();
    if (session?.user) {
      isAuthenticated = true;
      roles = (session.user[AUTH0_ROLES_CLAIM] as UserRole[]) ?? [];
      userName = session.user.name ?? session.user.email ?? null;
    }
  } catch {
    // not authenticated — nav shows login link
  }

  return (
    <html lang="en" className="h-full antialiased">
      <body className={`${inter.variable} ${manrope.variable} font-[Inter,sans-serif] min-h-full flex flex-col`}>
        <AppNav roles={roles} userName={userName} isAuthenticated={isAuthenticated} />
        <main className="flex-1 pt-[60px]" style={{ backgroundColor: "var(--ps-surface)" }}>
          {children}
        </main>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
