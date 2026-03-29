"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { formatDateTimeDdMmYyyy } from "@/lib/formatDate";

type LeadStats = {
  total: number;
  not_called: number;
  called: number;
  interested: number;
  closed: number;
};

type Lead = {
  id: number;
  name: string;
  phone: string;
  status: string;
  source: string;
  created_at: string;
  region: string | null;
};

export default function DashboardHomePage() {
  const [leadStats, setLeadStats] = useState<LeadStats | null>(null);
  const [mapsTotal, setMapsTotal] = useState<number | null>(null);
  const [recent, setRecent] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/dashboard-summary", { cache: "no-store" });
      if (cancelled) return;
      if (res.ok) {
        const body = (await res.json()) as {
          lead_stats?: LeadStats;
          maps_stats?: { total?: number };
          recent_leads?: Lead[];
        };
        if (body.lead_stats) setLeadStats(body.lead_stats);
        const m = body.maps_stats;
        setMapsTotal(typeof m?.total === "number" ? m.total : null);
        setRecent(body.recent_leads ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Dashboard</h1>
      <p className="mt-2 text-slate-400">
        Overview of leads and maps collection. Open a section from the sidebar
        for full tools.
      </p>

      {loading ? (
        <p className="mt-8 text-slate-500">Loading summary…</p>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Link
              href="/dashboard/leads"
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition hover:border-slate-600"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Leads
              </p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {leadStats?.total ?? "—"}
              </p>
              <p className="mt-1 text-sm text-slate-400">total in CRM</p>
            </Link>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                New leads
              </p>
              <p className="mt-2 text-3xl font-semibold text-amber-300">
                {leadStats?.not_called ?? "—"}
              </p>
              <p className="mt-1 text-sm text-slate-400">status &quot;new&quot;</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Interested
              </p>
              <p className="mt-2 text-3xl font-semibold text-emerald-300">
                {leadStats?.interested ?? "—"}
              </p>
              <p className="mt-1 text-sm text-slate-400">interested = yes</p>
            </div>
            <Link
              href="/dashboard/maps-data"
              className="rounded-xl border border-slate-800 bg-slate-900/50 p-4 transition hover:border-slate-600"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Maps businesses
              </p>
              <p className="mt-2 text-3xl font-semibold text-white">
                {mapsTotal ?? "—"}
              </p>
              <p className="mt-1 text-sm text-slate-400">scraped listings</p>
            </Link>
          </div>

          <section className="mt-10">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-lg font-medium text-slate-200">
                Recent leads
              </h2>
              <Link
                href="/dashboard/leads"
                className="text-sm text-blue-400 hover:underline"
              >
                View all
              </Link>
            </div>
            <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="border-b border-slate-800 bg-slate-900/80 text-slate-400">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Phone</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium">Source</th>
                    <th className="px-3 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {recent.map((l) => (
                    <tr key={l.id} className="bg-slate-950/40">
                      <td className="px-3 py-2 text-white">{l.name}</td>
                      <td className="px-3 py-2 text-slate-400">{l.phone}</td>
                      <td className="px-3 py-2 text-slate-300">{l.status}</td>
                      <td className="px-3 py-2 text-slate-500">{l.source}</td>
                      <td className="px-3 py-2 text-slate-500">
                        {formatDateTimeDdMmYyyy(l.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {recent.length === 0 ? (
                <p className="p-6 text-center text-slate-500">
                  No leads yet.
                </p>
              ) : null}
            </div>
          </section>

          <div className="mt-10 flex flex-wrap gap-3">
            <Link
              href="/dashboard/products"
              className="inline-block rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
            >
              Manage catalog
            </Link>
            <Link
              href="/dashboard/settings"
              className="inline-block rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
            >
              Settings
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
