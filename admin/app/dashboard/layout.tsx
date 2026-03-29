"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard" },
  { href: "/dashboard/leads", label: "Leads", icon: "group" },
  { href: "/dashboard/maps-data", label: "Maps Data", icon: "map" },
  { href: "/dashboard/catalog", label: "Catalogues", icon: "category" },
  { href: "/dashboard/products", label: "Products", icon: "inventory_2" },
  { href: "/dashboard/settings", label: "Settings", icon: "settings" },
] as const;

function NavIcon({
  name,
  filled,
  className = "",
}: {
  name: string;
  filled?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`material-symbols-outlined text-[1.25rem] ${className}`}
      style={
        filled
          ? ({ fontVariationSettings: "'FILL' 1" } as CSSProperties)
          : undefined
      }
    >
      {name}
    </span>
  );
}

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (cancelled) return;
      if (!res.ok) {
        router.replace("/login");
        return;
      }
      const data = (await res.json()) as { email?: string };
      setEmail(data.email ?? null);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-on-surface-variant">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <nav className="fixed top-0 z-50 flex h-20 w-full items-center justify-between border-b border-outline-variant/20 bg-[#0b0e14]/80 px-4 shadow-[0_8px_32px_rgba(0,0,0,0.4)] backdrop-blur-xl md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate font-headline text-lg font-bold uppercase tracking-tighter text-primary md:text-2xl">
            Star Uniform
          </span>
        </div>
        <div className="hidden max-w-[50%] flex-1 items-center justify-center gap-4 overflow-x-auto md:flex lg:max-w-none lg:gap-8">
          {nav.map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`shrink-0 whitespace-nowrap font-headline text-sm tracking-tight transition-all duration-300 ${
                  active
                    ? "border-b-2 border-primary font-bold text-primary"
                    : "font-medium text-on-surface/60 hover:bg-surface-container-high hover:text-primary"
                } rounded-lg px-2 py-1`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
        <div className="flex items-center gap-2 md:gap-4">
          {email ? (
            <span className="hidden max-w-[140px] truncate text-xs text-on-surface-variant sm:inline md:max-w-[200px]">
              {email}
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => void logout()}
            className="rounded-full px-3 py-1.5 text-xs font-medium text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-primary"
          >
            Logout
          </button>
        </div>
      </nav>

      <div className="fixed left-0 right-0 top-20 z-40 flex gap-1 overflow-x-auto border-b border-outline-variant/10 bg-[#0b0e14]/95 px-2 py-2 backdrop-blur-xl md:hidden">
        {nav.map((item) => {
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium uppercase tracking-wide ${
                active
                  ? "bg-surface-container-high text-primary"
                  : "text-on-surface-variant hover:bg-surface-container/80 hover:text-on-surface"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>

      <aside className="fixed left-0 top-0 z-40 hidden h-full w-64 flex-col border-r border-outline-variant/10 bg-[#0b0e14] pt-24 shadow-[10px_0_30px_rgba(0,0,0,0.3)] lg:flex">
        <div className="px-4 pb-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-secondary p-px">
              <div className="flex h-full w-full items-center justify-center rounded-[11px] bg-surface">
                <NavIcon name="blur_on" className="text-primary" />
              </div>
            </div>
            <div>
              <h3 className="font-headline font-black leading-none text-primary">
                Admin
              </h3>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-on-surface-variant">
                Star Uniform
              </p>
            </div>
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-2">
          {nav.map((item) => {
            const active =
              item.href === "/dashboard"
                ? pathname === "/dashboard"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-medium uppercase tracking-wide transition-all duration-200 ${
                  active
                    ? "border-r-4 border-primary bg-surface-container-high text-primary shadow-[0_0_15px_rgba(161,250,255,0.2)]"
                    : "text-on-surface/40 hover:translate-x-1 hover:bg-surface-container-high/50 hover:text-on-surface"
                }`}
              >
                <NavIcon name={item.icon} filled={active} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="px-3 pb-6">
          <Link
            href="/dashboard/products?add=1"
            className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-primary to-primary-dim py-3 font-bold text-on-primary shadow-[0_4px_20px_rgba(161,250,255,0.3)] transition-transform active:scale-95"
          >
            <NavIcon name="add" className="text-on-primary" />
            Add product
          </Link>
        </div>
      </aside>

      <main className="min-h-screen bg-surface pb-20 pt-[7.25rem] md:pt-24 lg:pb-8 lg:pl-64">
        <div className="mx-auto max-w-[1600px] px-4 md:px-8">{children}</div>
      </main>

      <nav className="fixed bottom-0 left-0 z-50 flex h-16 w-full items-center justify-around border-t border-outline-variant/10 bg-[#0b0e14]/90 px-1 backdrop-blur-xl lg:hidden">
        {[
          nav[0],
          nav[1],
          nav[2],
          { href: "/dashboard/products", label: "Add", icon: "add" } as const,
          nav[5],
        ].map((item) => {
          if (item.href === "/dashboard/products" && item.icon === "add") {
            return (
              <Link
                key="fab-products"
                href="/dashboard/products?add=1"
                className="-mt-8 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-primary shadow-[0_0_20px_rgba(161,250,255,0.5)]"
                aria-label="Add product"
              >
                <NavIcon name="add" className="text-on-primary" filled />
              </Link>
            );
          }
          const active =
            item.href === "/dashboard"
              ? pathname === "/dashboard"
              : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 ${
                active ? "text-primary" : "text-on-surface-variant"
              }`}
            >
              <NavIcon
                name={item.icon}
                filled={active}
                className="text-[1.2rem]"
              />
              <span className="max-w-full truncate px-0.5 text-[8px] font-bold uppercase tracking-tighter">
                {item.label.split(" ")[0]}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
