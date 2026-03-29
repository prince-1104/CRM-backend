"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDateTimeDdMmYyyy } from "@/lib/formatDate";

type Lead = {
  id: number;
  name: string;
  phone: string;
  source: string;
  created_at: string;
  updated_at: string | null;
  status: string;
  notes: string | null;
  called_date: string | null;
  called_by: string | null;
  interested: string | null;
  conversation_details: string | null;
  business_name: string | null;
  address: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  category: string | null;
  region: string | null;
  email: string | null;
  last_contacted: string | null;
  next_follow_up_at: string | null;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  pages: number;
};

type LeadStats = {
  total: number;
  not_called: number;
  called: number;
  interested: number;
  closed: number;
  by_status: Record<string, number>;
};

type TeamMember = { id: number; name: string; phone: string; calls_made: number };

const STATUS_OPTIONS = [
  "new",
  "called",
  "qualified",
  "closed",
  "not_interested",
] as const;

const INTERESTED_OPTIONS = ["", "yes", "no", "maybe"] as const;

function waLink(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return "#";
  return `https://wa.me/${digits}`;
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [stats, setStats] = useState<LeadStats | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [regionFilter, setRegionFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkStatus, setBulkStatus] = useState("new");
  const [bulkWorking, setBulkWorking] = useState(false);

  const [editing, setEditing] = useState<Lead | null>(null);
  const [editForm, setEditForm] = useState({
    status: "",
    notes: "",
    called_by: "",
    interested: "",
    conversation_details: "",
    region: "",
    called_date: "",
    last_contacted: "",
    next_follow_up_at: "",
  });
  const [savingLead, setSavingLead] = useState(false);

  const queryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(limit));
    if (search.trim()) p.set("search", search.trim());
    if (statusFilter) p.set("status", statusFilter);
    if (regionFilter.trim()) p.set("region", regionFilter.trim());
    if (sourceFilter.trim()) p.set("source", sourceFilter.trim());
    p.set("sort", "-created_at");
    return p.toString();
  }, [page, limit, search, statusFilter, regionFilter, sourceFilter]);

  /** Single round-trip: list + pagination + team + stats (server fans out in parallel). */
  const loadPage = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/leads-bundle?${queryString}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { detail?: string };
      setError(j.detail ?? "Failed to load leads");
      setLeads([]);
      setPagination(null);
      return;
    }
    const data = (await res.json()) as {
      data: Lead[];
      pagination: Pagination;
      team: TeamMember[];
      stats: LeadStats;
    };
    setLeads(data.data ?? []);
    setPagination(data.pagination ?? null);
    setTeam(Array.isArray(data.team) ? data.team : []);
    setStats(data.stats ?? null);
    setSelected(new Set());
  }, [queryString]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadPage();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadPage]);

  function openEdit(lead: Lead) {
    setEditing(lead);
    const isoLocal = (iso: string | null) => {
      if (!iso) return "";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return "";
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    setEditForm({
      status: lead.status,
      notes: lead.notes ?? "",
      called_by: lead.called_by ?? "",
      interested: lead.interested ?? "",
      conversation_details: lead.conversation_details ?? "",
      region: lead.region ?? "",
      called_date: isoLocal(lead.called_date),
      last_contacted: isoLocal(lead.last_contacted),
      next_follow_up_at: isoLocal(lead.next_follow_up_at),
    });
    setMessage(null);
  }

  function toIsoOrNull(s: string): string | null {
    if (!s.trim()) return null;
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }

  async function saveLead() {
    if (!editing) return;
    setSavingLead(true);
    setMessage(null);
    try {
      const body: Record<string, unknown> = {
        status: editForm.status,
        notes: editForm.notes || null,
        called_by: editForm.called_by || null,
        interested: editForm.interested || null,
        conversation_details: editForm.conversation_details || null,
        region: editForm.region || null,
        called_date: toIsoOrNull(editForm.called_date),
        last_contacted: toIsoOrNull(editForm.last_contacted),
        next_follow_up_at: toIsoOrNull(editForm.next_follow_up_at),
      };
      const res = await fetch(`/api/admin-proxy/leads/${editing.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) {
        setMessage(j.detail ?? "Update failed");
        return;
      }
      setEditing(null);
      setMessage("Lead updated.");
      await loadPage();
    } finally {
      setSavingLead(false);
    }
  }

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    const ids = leads.map((l) => l.id);
    const allSelected = ids.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  async function applyBulkStatus() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setBulkWorking(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin-proxy/leads/bulk-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lead_ids: ids, status: bulkStatus }),
      });
      if (!res.ok) {
        setMessage("Bulk update failed.");
        return;
      }
      setMessage(`Updated status for ${ids.length} lead(s).`);
      await loadPage();
    } finally {
      setBulkWorking(false);
    }
  }

  async function exportCsv() {
    const res = await fetch("/api/admin-proxy/leads/export/csv", {
      cache: "no-store",
    });
    if (!res.ok) {
      setMessage("Export failed.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "leads.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Leads</h1>
          <p className="mt-1 text-sm text-slate-400">
            Website and imported leads. Update status, notes, and follow-ups.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void exportCsv()}
          className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
        >
          Export CSV
        </button>
      </div>

      {stats ? (
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {(
            [
              ["Total", stats.total],
              ["New (not called)", stats.not_called],
              ["Status: called", stats.called],
              ["Interested", stats.interested],
              ["Closed", stats.closed],
            ] as const
          ).map(([label, n]) => (
            <div
              key={label}
              className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2"
            >
              <p className="text-xs text-slate-500">{label}</p>
              <p className="text-lg font-semibold text-white">{n}</p>
            </div>
          ))}
        </div>
      ) : null}

      {message ? (
        <p
          className={`mt-4 text-sm ${
            message.includes("failed") || message.includes("Failed")
              ? "text-red-400"
              : "text-emerald-400"
          }`}
        >
          {message}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/30 p-4">
        <div>
          <label className="block text-xs font-medium text-slate-400">Search</label>
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="Name or phone"
            className="mt-1 w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-500 focus:ring-2"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Status</label>
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-500 focus:ring-2"
          >
            <option value="">Any</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Region</label>
          <input
            value={regionFilter}
            onChange={(e) => {
              setRegionFilter(e.target.value);
              setPage(1);
            }}
            className="mt-1 w-36 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-500 focus:ring-2"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400">Source</label>
          <input
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value);
              setPage(1);
            }}
            placeholder="e.g. website_form"
            className="mt-1 w-40 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-500 focus:ring-2"
          />
        </div>
        <button
          type="button"
          onClick={() => void loadPage()}
          className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700"
        >
          Refresh
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <select
          value={bulkStatus}
          onChange={(e) => setBulkStatus(e.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={bulkWorking || selected.size === 0}
          onClick={() => void applyBulkStatus()}
          className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {bulkWorking ? "Applying…" : `Set status (${selected.size} selected)`}
        </button>
      </div>

      {loading ? (
        <p className="mt-6 text-slate-500">Loading…</p>
      ) : error ? (
        <p className="mt-6 text-red-400">{error}</p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="border-b border-slate-800 bg-slate-900/80 text-slate-400">
              <tr>
                <th className="w-10 px-2 py-2">
                  <input
                    type="checkbox"
                    checked={
                      leads.length > 0 && leads.every((l) => selected.has(l.id))
                    }
                    onChange={toggleSelectAllOnPage}
                    className="rounded border-slate-600"
                  />
                </th>
                <th className="px-2 py-2 font-medium">ID</th>
                <th className="px-2 py-2 font-medium">Name</th>
                <th className="px-2 py-2 font-medium">Phone</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Source</th>
                <th className="px-2 py-2 font-medium">Region</th>
                <th className="px-2 py-2 font-medium">Created</th>
                <th className="px-2 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {leads.map((l) => (
                <tr key={l.id} className="bg-slate-950/40">
                  <td className="px-2 py-2">
                    <input
                      type="checkbox"
                      checked={selected.has(l.id)}
                      onChange={() => toggleSelect(l.id)}
                      className="rounded border-slate-600"
                    />
                  </td>
                  <td className="px-2 py-2 text-slate-500">{l.id}</td>
                  <td className="px-2 py-2 text-white">{l.name}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-2">
                      <a
                        href={`tel:${l.phone}`}
                        className="text-blue-400 hover:underline"
                      >
                        {l.phone}
                      </a>
                      <a
                        href={waLink(l.phone)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-emerald-400 hover:underline"
                      >
                        WhatsApp
                      </a>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-slate-300">{l.status}</td>
                  <td className="px-2 py-2 text-slate-400">{l.source}</td>
                  <td className="px-2 py-2 text-slate-400">{l.region ?? "—"}</td>
                  <td className="px-2 py-2 text-slate-500">
                    {formatDateTimeDdMmYyyy(l.created_at)}
                  </td>
                  <td className="px-2 py-2">
                    <button
                      type="button"
                      onClick={() => openEdit(l)}
                      className="rounded bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {leads.length === 0 ? (
            <p className="p-6 text-center text-slate-500">No leads match filters.</p>
          ) : null}
        </div>
      )}

      {pagination && pagination.pages > 1 ? (
        <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-slate-400">
          <span>
            Page {pagination.page} of {pagination.pages} ({pagination.total}{" "}
            total)
          </span>
          <button
            type="button"
            disabled={pagination.page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded border border-slate-700 px-3 py-1 hover:bg-slate-800 disabled:opacity-40"
          >
            Previous
          </button>
          <button
            type="button"
            disabled={pagination.page >= pagination.pages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded border border-slate-700 px-3 py-1 hover:bg-slate-800 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      ) : null}

      {editing ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
            <h2 className="text-lg font-medium text-white">
              Lead #{editing.id} — {editing.name}
            </h2>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400">
                  Status
                </label>
                <select
                  value={editForm.status}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, status: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400">
                  Called by
                </label>
                <select
                  value={editForm.called_by}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, called_by: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  <option value="">—</option>
                  {team.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400">
                  Interested
                </label>
                <select
                  value={editForm.interested}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, interested: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  {INTERESTED_OPTIONS.map((v) => (
                    <option key={v || "unset"} value={v}>
                      {v || "—"}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400">
                  Region
                </label>
                <input
                  value={editForm.region}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, region: e.target.value }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400">
                  Notes
                </label>
                <textarea
                  value={editForm.notes}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, notes: e.target.value }))
                  }
                  rows={3}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400">
                  Conversation details
                </label>
                <textarea
                  value={editForm.conversation_details}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      conversation_details: e.target.value,
                    }))
                  }
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-400">
                    Called date
                  </label>
                  <input
                    type="datetime-local"
                    value={editForm.called_date}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        called_date: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400">
                    Last contacted
                  </label>
                  <input
                    type="datetime-local"
                    value={editForm.last_contacted}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        last_contacted: e.target.value,
                      }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400">
                  Next follow-up
                </label>
                <input
                  type="datetime-local"
                  value={editForm.next_follow_up_at}
                  onChange={(e) =>
                    setEditForm((f) => ({
                      ...f,
                      next_follow_up_at: e.target.value,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={savingLead}
                onClick={() => void saveLead()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {savingLead ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => setEditing(null)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
