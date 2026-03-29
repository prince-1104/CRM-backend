"use client";

import { useCallback, useEffect, useState } from "react";

type TeamMember = {
  id: number;
  name: string;
  phone: string;
  calls_made: number;
};

type AdminSettings = {
  maps: {
    api_configured: boolean;
    key_last4: string | null;
    default_radius_km: number;
    categories: Record<string, boolean>;
    last_collection_run: Record<string, unknown> | null;
    last_scrape_at: string | null;
  };
  business: Record<string, string>;
  export: Record<string, unknown>;
  account: { email: string };
  team: TeamMember[];
};

const MAP_CATEGORY_KEYS = ["restaurants", "lodging", "bar", "cafe"] as const;

export default function SettingsPage() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [radiusKm, setRadiusKm] = useState(15);
  const [categories, setCategories] = useState<Record<string, boolean>>({});
  const [business, setBusiness] = useState({
    business_name: "",
    phone: "",
    whatsapp: "",
    email: "",
    address: "",
    revenue_display: "",
  });
  const [exportPrefs, setExportPrefs] = useState({
    default_format: "csv",
    auto_backup_schedule: "weekly",
  });

  const [teamName, setTeamName] = useState("");
  const [teamPhone, setTeamPhone] = useState("");
  const [teamBusy, setTeamBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin-proxy/settings", { cache: "no-store" });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { detail?: string };
      setError(j.detail ?? "Failed to load settings");
      setSettings(null);
      return;
    }
    const data = (await res.json()) as AdminSettings;
    setSettings(data);
    setRadiusKm(Number(data.maps.default_radius_km) || 15);
    const cats = data.maps.categories ?? {};
    const nextCats: Record<string, boolean> = {};
    for (const k of MAP_CATEGORY_KEYS) {
      nextCats[k] = Boolean(cats[k]);
    }
    setCategories(nextCats);
    const b = data.business ?? {};
    setBusiness({
      business_name: String(b.business_name ?? ""),
      phone: String(b.phone ?? ""),
      whatsapp: String(b.whatsapp ?? ""),
      email: String(b.email ?? ""),
      address: String(b.address ?? ""),
      revenue_display: String(b.revenue_display ?? ""),
    });
    const ex = data.export ?? {};
    setExportPrefs({
      default_format: String(ex.default_format ?? "csv"),
      auto_backup_schedule: String(ex.auto_backup_schedule ?? "weekly"),
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function saveCoreSettings() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin-proxy/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          maps_defaults: {
            default_radius_km: Math.min(50, Math.max(5, Math.round(radiusKm))),
            categories,
          },
          business: {
            business_name: business.business_name || null,
            phone: business.phone || null,
            whatsapp: business.whatsapp || null,
            email: business.email || null,
            address: business.address || null,
            revenue_display: business.revenue_display || null,
          },
          export: {
            default_format: exportPrefs.default_format,
            auto_backup_schedule: exportPrefs.auto_backup_schedule,
          },
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) {
        setMessage(j.detail ?? "Save failed");
        return;
      }
      setSettings(j as AdminSettings);
      setMessage("Settings saved.");
    } finally {
      setSaving(false);
    }
  }

  async function addTeamMember(e: React.FormEvent) {
    e.preventDefault();
    const name = teamName.trim();
    const phone = teamPhone.trim();
    if (!name || !phone) return;
    setTeamBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin-proxy/team-members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });
      const j = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) {
        setMessage(j.detail ?? "Could not add team member");
        return;
      }
      setTeamName("");
      setTeamPhone("");
      await load();
      setMessage("Team member added.");
    } finally {
      setTeamBusy(false);
    }
  }

  async function removeTeamMember(id: number) {
    if (!confirm("Remove this team member?")) return;
    setTeamBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin-proxy/team-members/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setMessage("Remove failed.");
        return;
      }
      await load();
      setMessage("Team member removed.");
    } finally {
      setTeamBusy(false);
    }
  }

  if (loading) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-4 text-slate-500">Loading…</p>
      </div>
    );
  }

  if (error || !settings) {
    return (
      <div>
        <h1 className="text-2xl font-semibold text-white">Settings</h1>
        <p className="mt-4 text-red-400">{error ?? "Unknown error"}</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Settings</h1>
      <p className="mt-1 text-sm text-slate-400">
        Maps defaults, business profile, export preferences, and sales team.
      </p>

      {message ? (
        <p
          className={`mt-4 text-sm ${
            message.includes("failed") || message.includes("Could not")
              ? "text-red-400"
              : "text-emerald-400"
          }`}
        >
          {message}
        </p>
      ) : null}

      <div className="mt-8 space-y-10">
        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-lg font-medium text-slate-200">Account</h2>
          <p className="mt-1 text-sm text-slate-500">
            Signed-in admin (from environment).
          </p>
          <p className="mt-3 text-white">{settings.account.email}</p>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-lg font-medium text-slate-200">Maps API</h2>
          <p className="mt-2 text-sm text-slate-400">
            Status:{" "}
            {settings.maps.api_configured ? (
              <span className="text-emerald-400">configured</span>
            ) : (
              <span className="text-amber-400">not configured</span>
            )}
            {settings.maps.key_last4 ? (
              <span className="text-slate-500">
                {" "}
                (key …{settings.maps.key_last4})
              </span>
            ) : null}
          </p>
          {settings.maps.last_scrape_at ? (
            <p className="mt-1 text-xs text-slate-500">
              Last business scrape in DB: {settings.maps.last_scrape_at}
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-lg font-medium text-slate-200">
            Maps collection defaults
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Used as defaults on the Maps Data page when running a scrape.
          </p>
          <div className="mt-4">
            <label className="block text-xs font-medium text-slate-400">
              Default radius (km, 5–50)
            </label>
            <input
              type="number"
              min={5}
              max={50}
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="mt-1 w-32 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-500 focus:ring-2"
            />
          </div>
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-slate-400">
              Enabled categories
            </p>
            {MAP_CATEGORY_KEYS.map((key) => (
              <label
                key={key}
                className="flex items-center gap-2 text-sm text-slate-300"
              >
                <input
                  type="checkbox"
                  checked={Boolean(categories[key])}
                  onChange={(e) =>
                    setCategories((c) => ({ ...c, [key]: e.target.checked }))
                  }
                  className="rounded border-slate-600"
                />
                {key}
              </label>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-lg font-medium text-slate-200">Business info</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {(
              [
                ["business_name", "Business name"],
                ["phone", "Phone"],
                ["whatsapp", "WhatsApp number (shown on public site)"],
                ["email", "Email"],
                ["address", "Address"],
                ["revenue_display", "Revenue display (optional)"],
              ] as const
            ).map(([field, label]) => (
              <div key={field} className={field === "address" ? "sm:col-span-2" : ""}>
                <label className="block text-xs font-medium text-slate-400">
                  {label}
                </label>
                {field === "address" ? (
                  <textarea
                    value={business[field]}
                    onChange={(e) =>
                      setBusiness((b) => ({ ...b, [field]: e.target.value }))
                    }
                    rows={2}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-500 focus:ring-2"
                  />
                ) : (
                  <input
                    value={business[field]}
                    onChange={(e) =>
                      setBusiness((b) => ({ ...b, [field]: e.target.value }))
                    }
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-500 focus:ring-2"
                  />
                )}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-lg font-medium text-slate-200">Export preferences</h2>
          <div className="mt-4 flex flex-wrap gap-6">
            <div>
              <label className="block text-xs font-medium text-slate-400">
                Default format
              </label>
              <select
                value={exportPrefs.default_format}
                onChange={(e) =>
                  setExportPrefs((p) => ({
                    ...p,
                    default_format: e.target.value,
                  }))
                }
                className="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-500 focus:ring-2"
              >
                <option value="csv">csv</option>
                <option value="excel">excel</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400">
                Backup schedule label
              </label>
              <select
                value={exportPrefs.auto_backup_schedule}
                onChange={(e) =>
                  setExportPrefs((p) => ({
                    ...p,
                    auto_backup_schedule: e.target.value,
                  }))
                }
                className="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-500 focus:ring-2"
              >
                <option value="daily">daily</option>
                <option value="weekly">weekly</option>
                <option value="monthly">monthly</option>
                <option value="off">off</option>
              </select>
            </div>
          </div>
        </section>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => void saveCoreSettings()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save maps, business & export"}
          </button>
        </div>

        <section className="rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-lg font-medium text-slate-200">Team members</h2>
          <p className="mt-1 text-sm text-slate-500">
            Used when attributing calls on leads (<code className="text-slate-400">called_by</code>
            ).
          </p>

          <form
            onSubmit={addTeamMember}
            className="mt-4 flex flex-wrap items-end gap-3"
          >
            <div>
              <label className="block text-xs font-medium text-slate-400">
                Name
              </label>
              <input
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="mt-1 w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-500 focus:ring-2"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400">
                Phone
              </label>
              <input
                value={teamPhone}
                onChange={(e) => setTeamPhone(e.target.value)}
                className="mt-1 w-48 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white outline-none ring-blue-500 focus:ring-2"
              />
            </div>
            <button
              type="submit"
              disabled={teamBusy}
              className="rounded-lg bg-slate-800 px-4 py-2 text-sm text-white hover:bg-slate-700 disabled:opacity-50"
            >
              Add
            </button>
          </form>

          <div className="mt-6 overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-900/80 text-slate-400">
                <tr>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Phone</th>
                  <th className="px-3 py-2 font-medium">Calls</th>
                  <th className="px-3 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {settings.team.map((m) => (
                  <tr key={m.id} className="bg-slate-950/40">
                    <td className="px-3 py-2 text-white">{m.name}</td>
                    <td className="px-3 py-2 text-slate-300">{m.phone}</td>
                    <td className="px-3 py-2 text-slate-400">{m.calls_made}</td>
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        disabled={teamBusy}
                        onClick={() => void removeTeamMember(m.id)}
                        className="rounded bg-red-900/50 px-2 py-1 text-xs text-red-200 hover:bg-red-900/80 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {settings.team.length === 0 ? (
              <p className="p-4 text-center text-slate-500">No team members yet.</p>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}
