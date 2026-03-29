"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type MapsRegion = {
  name: string;
  lat: number;
  lng: number;
  last_scrape: string | null;
  count: number;
};

type LatLng = { lat: number; lng: number };

type GoogleMapsLike = {
  maps?: {
    Map: new (
      el: HTMLElement,
      opts: {
        center: LatLng;
        zoom: number;
        mapTypeControl?: boolean;
        streetViewControl?: boolean;
        fullscreenControl?: boolean;
      }
    ) => {
      addListener: (
        eventName: "click",
        handler: (e: unknown) => void
      ) => { remove?: () => void };
    };
    Marker: new (opts: { position: LatLng; map: unknown }) => {
      setPosition: (p: LatLng) => void;
      setMap: (m: unknown) => void;
    };
    Circle: new (opts: {
      map: unknown;
      center: LatLng;
      radius: number;
      fillColor?: string;
      fillOpacity?: number;
      strokeColor?: string;
      strokeOpacity?: number;
      strokeWeight?: number;
      clickable?: boolean;
    }) => {
      setCenter: (c: LatLng) => void;
      setMap: (m: unknown) => void;
    };
  };
};

function getGoogleMaps(): GoogleMapsLike | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { google?: GoogleMapsLike };
  if (!w.google?.maps) return null;
  return w.google;
}

type MapsBusiness = {
  id: number;
  google_place_id: string | null;
  latitude?: number | null;
  longitude?: number | null;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  category: string | null;
  region: string | null;
  scraped_at: string;
  updated_at: string;
  is_converted_to_lead: boolean;
  contact_status: string;
  notes: string | null;
  ai_confidence: number | null;
  ai_type: string | null;
  lead_score: number | null;
  ai_last_updated: string | null;
  is_hot_lead: boolean;
};

type Pagination = {
  page: number;
  limit: number;
  total: number;
  pages: number;
};

function formatCategoryLabel(category: string): string {
  if (category === "catering") return "Catering services";
  return category;
}

const CONTACT_STATUSES = [
  "not_contacted",
  "contacted",
  "interested",
  "not_interested",
  "converted",
] as const;

function waLink(phone: string | null): string {
  if (!phone) return "#";
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return "#";
  return `https://wa.me/${digits}`;
}

function gmapsPlaceLink(placeId: string | null): string | null {
  if (!placeId) return null;
  return `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(
    placeId
  )}`;
}

function useGoogleMapsScript(apiKey: string | undefined) {
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!apiKey) {
      setError("Missing NEXT_PUBLIC_GOOGLE_MAPS_JS_API_KEY");
      return;
    }
    if (typeof window === "undefined") return;
    if (getGoogleMaps()) {
      setLoaded(true);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-google-maps="1"]'
    );
    if (existing) {
      existing.addEventListener("load", () => setLoaded(true));
      existing.addEventListener("error", () =>
        setError("Failed to load Google Maps script")
      );
      return;
    }
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey
    )}`;
    s.async = true;
    s.defer = true;
    s.dataset.googleMaps = "1";
    s.addEventListener("load", () => setLoaded(true));
    s.addEventListener("error", () =>
      setError("Failed to load Google Maps script")
    );
    document.head.appendChild(s);
  }, [apiKey]);

  return { loaded, error };
}

function MapPicker(props: {
  enabled: boolean;
  loaded: boolean;
  center: LatLng | null;
  radiusMeters: number;
  onCenterChange: (c: LatLng) => void;
}) {
  const { enabled, loaded, center, radiusMeters, onCenterChange } = props;

  useEffect(() => {
    if (!enabled) return;
    if (!loaded) return;
    if (!center) return;

    const el = document.getElementById("maps-picker");
    if (!el) return;

    const g = getGoogleMaps();
    if (!g?.maps) return;

    const map = new g.maps.Map(el, {
      center,
      zoom: 12,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });

    const marker = new g.maps.Marker({
      position: center,
      map,
    });

    const circle = new g.maps.Circle({
      map,
      center,
      radius: Math.max(10, radiusMeters),
      fillColor: "#3b82f6",
      fillOpacity: 0.12,
      strokeColor: "#60a5fa",
      strokeOpacity: 0.9,
      strokeWeight: 2,
      clickable: false,
    });

    const clickListener = map.addListener("click", (e: unknown) => {
      const evt = e as {
        latLng?: { lat?: () => number; lng?: () => number };
      };
      const lat = evt?.latLng?.lat?.();
      const lng = evt?.latLng?.lng?.();
      if (typeof lat !== "number" || typeof lng !== "number") return;
      const next = { lat, lng };
      marker.setPosition(next);
      circle.setCenter(next);
      onCenterChange(next);
    });

    return () => {
      clickListener?.remove?.();
      marker?.setMap?.(null);
      circle?.setMap?.(null);
    };
  }, [enabled, loaded, center, radiusMeters, onCenterChange]);

  useEffect(() => {
    if (!enabled) return;
    if (!loaded) return;
    if (!center) return;
    if (!getGoogleMaps()) return;
    // This component currently recreates the map on center changes; keep this effect
    // to ensure React doesn't optimize away re-renders.
  }, [enabled, loaded, center, radiusMeters]);

  return (
    <div
      id="maps-picker"
      className="mt-3 h-[320px] w-full overflow-hidden rounded-lg border border-slate-800 bg-slate-900"
    />
  );
}

export default function MapsDataPage() {
  const [regions, setRegions] = useState<MapsRegion[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);

  const [scrapeRegion, setScrapeRegion] = useState("");
  const [scrapeCategory, setScrapeCategory] = useState("");
  const [scrapeRadiusStr, setScrapeRadiusStr] = useState("15");
  const [useMapPicker, setUseMapPicker] = useState(false);
  const [center, setCenter] = useState<LatLng | null>(null);
  const [scraping, setScraping] = useState(false);
  const [scrapeMsg, setScrapeMsg] = useState<string | null>(null);
  const [radiusPopup, setRadiusPopup] = useState<string | null>(null);

  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const [rows, setRows] = useState<MapsBusiness[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [search, setSearch] = useState("");
  const [filterRegion, setFilterRegion] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [sortField, setSortField] = useState("-lead_score");
  const [highValueOnly, setHighValueOnly] = useState(false);
  const [aiScoring, setAiScoring] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState<MapsBusiness | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [editConverted, setEditConverted] = useState(false);
  const [saving, setSaving] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<
    | null
    | {
        mode: "selected" | "all_filtered";
        ids: number[];
        label: string;
      }
  >(null);

  const mapsQueryString = useMemo(() => {
    const p = new URLSearchParams();
    p.set("page", String(page));
    p.set("limit", String(limit));
    p.set("sort", sortField);
    if (search.trim()) p.set("search", search.trim());
    if (filterRegion) p.set("region", filterRegion);
    if (filterCategory) p.set("category", filterCategory);
    if (filterStatus) p.set("contact_status", filterStatus);
    if (highValueOnly) p.set("lead_score_min", "80");
    return p.toString();
  }, [page, limit, search, filterRegion, filterCategory, filterStatus, sortField, highValueOnly]);

  /** One round-trip: regions, categories, stats, listings (server fans out in parallel). */
  const loadPage = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/maps-bundle?${mapsQueryString}`, {
      cache: "no-store",
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { detail?: string };
      setError(j.detail ?? "Failed to load maps data");
      setRows([]);
      setPagination(null);
      return;
    }
    const data = (await res.json()) as {
      regions: MapsRegion[];
      categories: string[];
      stats: Record<string, unknown>;
      listings: { data: MapsBusiness[]; pagination: Pagination };
    };
    const list = Array.isArray(data.regions) ? data.regions : [];
    const cats = Array.isArray(data.categories) ? data.categories : [];
    setRegions(list);
    setCategories(cats);
    setStats(data.stats ?? null);
    setRows(data.listings?.data ?? []);
    setPagination(data.listings?.pagination ?? null);
    setScrapeRegion((prev) => prev || (list[0]?.name ?? ""));
    setScrapeCategory((prev) => prev || (cats[0] ?? ""));
  }, [mapsQueryString]);

  const MIN_RADIUS_KM = 5;
  const MAX_RADIUS_KM = 50;

  function parseRadiusKm(str: string): number | null {
    const s = str.trim();
    if (!s) return null;
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    return n;
  }

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

  useEffect(() => {
    // Filters/search changing means "selected" no longer maps cleanly to what's visible.
    setSelectedIds(new Set());
  }, [search, filterRegion, filterCategory, filterStatus]);

  async function runScrape() {
    setScraping(true);
    setScrapeMsg(null);
    setRadiusPopup(null);
    try {
      const effectiveCenter =
        useMapPicker && center ? center : null;

      const radiusKmRaw = parseRadiusKm(scrapeRadiusStr);
      if (radiusKmRaw == null) {
        setRadiusPopup(
          `Radius km must be a number between ${MIN_RADIUS_KM} and ${MAX_RADIUS_KM}.`
        );
        return;
      }
      const radiusKmRounded = Math.round(radiusKmRaw);
      if (
        radiusKmRounded < MIN_RADIUS_KM ||
        radiusKmRounded > MAX_RADIUS_KM
      ) {
        setRadiusPopup(
          `Max radius is ${MAX_RADIUS_KM} km (min ${MIN_RADIUS_KM} km).`
        );
        return;
      }
      const res = await fetch("/api/admin-proxy/maps/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region: scrapeRegion,
          category: scrapeCategory,
          radius_km: radiusKmRounded,
          lat: effectiveCenter?.lat ?? null,
          lng: effectiveCenter?.lng ?? null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        detail?: string;
        message?: string;
        status?: string;
      };
      if (!res.ok) {
        setScrapeMsg(j.detail ?? "Scrape failed");
        return;
      }
      setScrapeMsg(j.message ?? "Done.");
      await loadPage();
    } finally {
      setScraping(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTestMsg(null);
    try {
      const res = await fetch("/api/admin-proxy/maps/test-connection", {
        method: "POST",
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        detail?: string;
      };
      const okVal = j.ok === true;
      const msg = j.message ?? j.detail;
      setTestMsg(okVal ? `OK: ${msg ?? ""}` : `Failed: ${msg ?? "unknown"}`);
    } finally {
      setTesting(false);
    }
  }

  async function runAiScoring() {
    setAiScoring(true);
    setScrapeMsg(null);
    try {
      const res = await fetch("/api/admin-proxy/maps/ai-score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          region: filterRegion || null,
          category: filterCategory || null,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        detail?: string;
        message?: string;
      };
      if (!res.ok) {
        setScrapeMsg(j.detail ?? "AI scoring failed");
        return;
      }
      setScrapeMsg(j.message ?? "AI scoring complete.");
      await loadPage();
    } finally {
      setAiScoring(false);
    }
  }

  function openEdit(row: MapsBusiness) {
    setEditing(row);
    setEditNotes(row.notes ?? "");
    setEditStatus(row.contact_status);
    setEditConverted(row.is_converted_to_lead);
  }

  async function saveEdit() {
    if (!editing) return;
    setSaving(true);
    try {
      const res = await fetch(
        `/api/admin-proxy/maps/businesses/${editing.id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notes: editNotes,
            contact_status: editStatus,
            is_converted_to_lead: editConverted,
          }),
        },
      );
      const j = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) {
        setScrapeMsg(j.detail ?? "Save failed");
        return;
      }
      setEditing(null);
      setScrapeMsg("Listing updated.");
      await loadPage();
    } finally {
      setSaving(false);
    }
  }

  async function exportFiltered(format: "csv" | "excel" | "pdf") {
    const res = await fetch("/api/admin-proxy/maps/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        region: filterRegion || null,
        category: filterCategory || null,
        format,
      }),
    });
    if (!res.ok) {
      setScrapeMsg("Export failed.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download =
      format === "csv"
        ? "maps_filtered.csv"
        : format === "pdf"
          ? "maps_filtered.pdf"
          : "maps_filtered.xls";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportAllCsv() {
    const res = await fetch("/api/admin-proxy/maps/export/csv", {
      cache: "no-store",
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "maps_businesses.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function exportAllPdf() {
    const res = await fetch("/api/admin-proxy/maps/export/pdf", {
      cache: "no-store",
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "maps_businesses.pdf";
    a.click();
    URL.revokeObjectURL(url);
  }

  function toggleRowSelected(id: number, checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function setAllOnPageSelected(checked: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const r of rows) {
        if (checked) next.add(r.id);
        else next.delete(r.id);
      }
      return next;
    });
  }

  async function fetchAllFilteredIds(): Promise<number[]> {
    // Fetch IDs across all pages for current filters/search.
    const ids: number[] = [];
    const limitForScan = 200;
    let pageNum = 1;

    while (true) {
      const p = new URLSearchParams();
      p.set("page", String(pageNum));
      p.set("limit", String(limitForScan));
      p.set("sort", sortField);
      if (search.trim()) p.set("search", search.trim());
      if (filterRegion) p.set("region", filterRegion);
      if (filterCategory) p.set("category", filterCategory);
      if (filterStatus) p.set("contact_status", filterStatus);
      if (highValueOnly) p.set("lead_score_min", "80");

      const res = await fetch(`/api/admin-proxy/maps-businesses?${p.toString()}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(j.detail ?? "Failed to scan listings for deletion");
      }
      const j = (await res.json()) as {
        data?: Array<{ id: number }>;
        pagination?: { page: number; pages: number };
      };
      const batch = Array.isArray(j.data) ? j.data : [];
      for (const r of batch) {
        if (typeof r?.id === "number") ids.push(r.id);
      }

      const pages = j.pagination?.pages ?? pageNum;
      if (pageNum >= pages) break;
      pageNum += 1;
    }

    return ids;
  }

  async function runBulkDelete(ids: number[], label: string) {
    if (ids.length === 0) return;
    setDeleting(true);
    setScrapeMsg(null);
    try {
      const chunkSize = 500;
      let deletedTotal = 0;

      for (let i = 0; i < ids.length; i += chunkSize) {
        const chunk = ids.slice(i, i + chunkSize);
        setScrapeMsg(
          `Deleting ${label}… (${Math.min(i + chunk.length, ids.length)}/${ids.length})`
        );
        const res = await fetch("/api/admin-proxy/maps/businesses/bulk-delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chunk }),
        });
        const j = (await res.json().catch(() => ({}))) as {
          detail?: string;
          deleted?: number;
        };
        if (!res.ok) {
          throw new Error(j.detail ?? "Delete failed");
        }
        deletedTotal += Number(j.deleted ?? 0);
      }

      setSelectedIds(new Set());
      setScrapeMsg(`Deleted ${deletedTotal} listing(s).`);
      await loadPage();
    } finally {
      setDeleting(false);
    }
  }

  const regionNames = regions.map((r) => r.name);
  const selectedRegion = regions.find((r) => r.name === scrapeRegion) ?? null;
  const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_JS_API_KEY;
  const { loaded: mapsLoaded, error: mapsScriptError } =
    useGoogleMapsScript(mapsKey);

  useEffect(() => {
    if (!useMapPicker) return;
    if (!selectedRegion) return;
    // Keep map center in sync with the selected region.
    // (If user clicks the map, region changes will move it again.)
    setCenter({ lat: selectedRegion.lat, lng: selectedRegion.lng });
  }, [useMapPicker, selectedRegion]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Maps Data</h1>
      <p className="mt-1 text-sm text-slate-400">
        Collect Places listings by region, then review and update contact status.
      </p>

      {stats ? (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
            <p className="text-xs text-slate-500">Total businesses</p>
            <p className="text-lg font-semibold text-white">
              {String(stats.total ?? stats.total_businesses ?? "—")}
            </p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
            <p className="text-xs text-slate-500">API</p>
            <p className="text-sm text-slate-200">
              {stats.maps_api_configured ? (
                <span className="text-emerald-400">Ready</span>
              ) : (
                <span className="text-amber-400">Not configured</span>
              )}
            </p>
          </div>
          <div className="col-span-2 rounded-lg border border-slate-800 bg-slate-900/50 px-3 py-2">
            <p className="text-xs text-slate-500">Last scrape (DB)</p>
            <p className="text-sm text-slate-300">
              {stats.last_scrape_at
                ? String(stats.last_scrape_at)
                : "—"}
            </p>
          </div>
        </div>
      ) : null}

      <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
        <h2 className="text-lg font-medium text-slate-200">Run collection</h2>
        <p className="mt-1 text-sm text-slate-500">
          Nearby Search + Place Details for the chosen region and category.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400">
              Region
            </label>
            <select
              value={scrapeRegion}
              onChange={(e) => setScrapeRegion(e.target.value)}
              className="mt-1 min-w-[140px] rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              {regionNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400">
              Category
            </label>
            <select
              value={scrapeCategory}
              onChange={(e) => setScrapeCategory(e.target.value)}
              className="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {formatCategoryLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400">
              Radius km
            </label>
            <input
              type="number"
              min={5}
              max={50}
              value={scrapeRadiusStr}
              onChange={(e) => setScrapeRadiusStr(e.target.value)}
              className="mt-1 w-24 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </div>
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2 text-sm text-slate-200 hover:bg-slate-950/50">
            <input
              type="checkbox"
              checked={useMapPicker}
              onChange={(e) => setUseMapPicker(e.target.checked)}
              className="h-5 w-5 rounded border-slate-600 bg-slate-950 text-blue-500 accent-blue-500"
            />
            Pick center from map
          </label>
          <button
            type="button"
            disabled={
              scraping ||
              !scrapeRegion ||
              !scrapeCategory ||
              parseRadiusKm(scrapeRadiusStr) == null ||
              (useMapPicker && !center)
            }
            onClick={() => void runScrape()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {scraping ? "Scraping…" : "Start scrape"}
          </button>
          <button
            type="button"
            disabled={testing}
            onClick={() => void runTest()}
            className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800"
          >
            {testing ? "Testing…" : "Test Places API"}
          </button>
          <button
            type="button"
            disabled={aiScoring}
            onClick={() => void runAiScoring()}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:opacity-50"
          >
            {aiScoring ? "Scoring…" : "Run AI Scoring"}
          </button>
        </div>
        {scrapeMsg ? (
          <p className="mt-3 text-sm text-slate-300">{scrapeMsg}</p>
        ) : null}
        {testMsg ? (
          <p className="mt-2 text-sm text-slate-400">{testMsg}</p>
        ) : null}

        {useMapPicker ? (
          <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-slate-400">
                Click the map to set scrape center. Current:{" "}
                <span className="text-slate-200">
                  {center
                    ? `${center.lat.toFixed(5)}, ${center.lng.toFixed(5)}`
                    : "—"}
                </span>
              </p>
              {mapsScriptError ? (
                <p className="text-xs text-amber-400">{mapsScriptError}</p>
              ) : null}
            </div>
            <MapPicker
              enabled={useMapPicker}
              loaded={mapsLoaded}
              center={center ?? (selectedRegion ? { lat: selectedRegion.lat, lng: selectedRegion.lng } : null)}
              radiusMeters={
                (() => {
                  const r = parseRadiusKm(scrapeRadiusStr);
                  if (r == null) return MIN_RADIUS_KM * 1000;
                  const rounded = Math.round(r);
                  const clamped = Math.min(
                    MAX_RADIUS_KM,
                    Math.max(MIN_RADIUS_KM, rounded)
                  );
                  return clamped * 1000;
                })()
              }
              onCenterChange={(c) => setCenter(c)}
            />
          </div>
        ) : null}
      </section>

      {radiusPopup ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="max-w-sm rounded-xl border border-slate-700 bg-slate-900 p-4 shadow-xl">
            <h3 className="text-sm font-medium text-white">Invalid radius</h3>
            <p className="mt-2 text-sm text-slate-300">{radiusPopup}</p>
            <div className="mt-4 flex justify-end">
              <button
                type="button"
                onClick={() => setRadiusPopup(null)}
                className="rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200 hover:bg-slate-800"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="mt-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-medium text-slate-200">Listings</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={deleting || selectedIds.size === 0}
              onClick={() => {
                const ids = Array.from(selectedIds);
                setConfirmDelete({
                  mode: "selected",
                  ids,
                  label: `selected (${ids.length})`,
                });
              }}
              className="rounded-lg border border-red-600/60 px-3 py-2 text-xs text-red-200 hover:bg-red-950/30 disabled:opacity-40"
              title={
                selectedIds.size === 0
                  ? "Select rows to delete"
                  : "Delete the selected listings"
              }
            >
              Delete selected
            </button>
            <button
              type="button"
              disabled={deleting || (pagination?.total ?? 0) === 0}
              onClick={() => {
                const total = pagination?.total ?? 0;
                setConfirmDelete({
                  mode: "all_filtered",
                  ids: [],
                  label: `all filtered (${total})`,
                });
              }}
              className="rounded-lg border border-red-600/60 px-3 py-2 text-xs text-red-200 hover:bg-red-950/30 disabled:opacity-40"
              title="Delete all listings matching the current filters"
            >
              Delete all (filtered)
            </button>
            <button
              type="button"
              onClick={() => void exportAllCsv()}
              className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
            >
              Export all CSV
            </button>
            <button
              type="button"
              onClick={() => void exportAllPdf()}
              className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
            >
              Export all PDF
            </button>
            <button
              type="button"
              onClick={() => void exportFiltered("csv")}
              className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
            >
              Export filtered CSV
            </button>
            <button
              type="button"
              onClick={() => void exportFiltered("excel")}
              className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
            >
              Export filtered Excel
            </button>
            <button
              type="button"
              onClick={() => void exportFiltered("pdf")}
              className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
            >
              Export filtered PDF
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-800 bg-slate-900/30 p-4">
          <div>
            <label className="block text-xs font-medium text-slate-400">
              Search
            </label>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className="mt-1 w-44 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400">
              Region
            </label>
            <select
              value={filterRegion}
              onChange={(e) => {
                setFilterRegion(e.target.value);
                setPage(1);
              }}
              className="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="">Any</option>
              {regionNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400">
              Category
            </label>
            <select
              value={filterCategory}
              onChange={(e) => {
                setFilterCategory(e.target.value);
                setPage(1);
              }}
              className="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="">Any</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {formatCategoryLabel(c)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400">
              Contact status
            </label>
            <select
              value={filterStatus}
              onChange={(e) => {
                setFilterStatus(e.target.value);
                setPage(1);
              }}
              className="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="">Any</option>
              {CONTACT_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400">
              Sort by
            </label>
            <select
              value={sortField}
              onChange={(e) => {
                setSortField(e.target.value);
                setPage(1);
              }}
              className="mt-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
            >
              <option value="-lead_score">Score (high first)</option>
              <option value="-ai_confidence">AI Confidence</option>
              <option value="-rating">Rating</option>
              <option value="-review_count">Reviews</option>
              <option value="-scraped_at">Newest</option>
              <option value="name">Name A-Z</option>
            </select>
          </div>
          <label className="flex cursor-pointer items-center gap-2 self-end rounded-lg border border-slate-800 bg-slate-950/30 px-3 py-2 text-sm text-slate-200 hover:bg-slate-950/50">
            <input
              type="checkbox"
              checked={highValueOnly}
              onChange={(e) => {
                setHighValueOnly(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-purple-500 accent-purple-500"
            />
            High value only
          </label>
          <button
            type="button"
            onClick={() => void loadPage()}
            className="rounded-lg bg-slate-800 px-3 py-2 text-sm text-white hover:bg-slate-700"
          >
            Refresh
          </button>
        </div>

        {loading && rows.length === 0 ? (
          <p className="mt-6 text-slate-500">Loading…</p>
        ) : error ? (
          <p className="mt-6 text-red-400">{error}</p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full min-w-[1200px] text-left text-sm">
              <thead className="border-b border-slate-800 bg-slate-900/80 text-slate-400">
                <tr>
                  <th className="w-10 px-2 py-2 font-medium">
                    <input
                      type="checkbox"
                      aria-label="Select all on page"
                      checked={
                        rows.length > 0 &&
                        rows.every((r) => selectedIds.has(r.id))
                      }
                      onChange={(e) => setAllOnPageSelected(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-blue-500 accent-blue-500"
                    />
                  </th>
                  <th className="px-2 py-2 font-medium">Name</th>
                  <th className="px-2 py-2 font-medium">Phone</th>
                  <th className="px-2 py-2 font-medium">Score</th>
                  <th className="px-2 py-2 font-medium">AI %</th>
                  <th className="px-2 py-2 font-medium">Region</th>
                  <th className="px-2 py-2 font-medium">Category</th>
                  <th className="px-2 py-2 font-medium">Rating</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  <th className="px-2 py-2 font-medium">Lead</th>
                  <th className="px-2 py-2 font-medium">Map</th>
                  <th className="px-2 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {rows.map((r) => (
                  <tr key={r.id} className="bg-slate-950/40">
                    <td className="px-2 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.name}`}
                        checked={selectedIds.has(r.id)}
                        onChange={(e) => toggleRowSelected(r.id, e.target.checked)}
                        className="h-4 w-4 rounded border-slate-600 bg-slate-950 text-blue-500 accent-blue-500"
                      />
                    </td>
                    <td className="px-2 py-2 text-white">
                      {gmapsPlaceLink(r.google_place_id) ? (
                        <a
                          href={gmapsPlaceLink(r.google_place_id) as string}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-200 hover:underline"
                        >
                          {r.name}
                        </a>
                      ) : (
                        r.name
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {r.phone ? (
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={`tel:${r.phone}`}
                            className="text-blue-400 hover:underline"
                          >
                            {r.phone}
                          </a>
                          <a
                            href={waLink(r.phone)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-emerald-400 hover:underline"
                          >
                            WA
                          </a>
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex items-center gap-1.5">
                        {r.lead_score != null ? (
                          <span
                            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${
                              r.lead_score > 80
                                ? "bg-emerald-950/60 text-emerald-400"
                                : r.lead_score > 50
                                  ? "bg-amber-950/60 text-amber-400"
                                  : "bg-slate-800 text-slate-400"
                            }`}
                          >
                            {r.lead_score.toFixed(0)}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                        {r.is_hot_lead && (
                          <span className="rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase leading-none text-white">
                            HOT
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      {r.ai_confidence != null ? (
                        <div className="flex items-center gap-1.5">
                          <div className="h-1.5 w-12 overflow-hidden rounded-full bg-slate-800">
                            <div
                              className={`h-full rounded-full ${
                                r.ai_confidence > 75
                                  ? "bg-emerald-500"
                                  : r.ai_confidence > 40
                                    ? "bg-amber-500"
                                    : "bg-red-500"
                              }`}
                              style={{ width: `${r.ai_confidence}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-400">
                            {r.ai_confidence}%
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-slate-400">
                      {r.region ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-slate-400">
                      {r.category ?? "—"}
                    </td>
                    <td className="px-2 py-2 text-slate-400">
                      {r.rating != null ? r.rating.toFixed(1) : "—"}
                    </td>
                    <td className="px-2 py-2 text-slate-300">
                      {r.contact_status}
                    </td>
                    <td className="px-2 py-2 text-slate-400">
                      {r.is_converted_to_lead ? "Yes" : "No"}
                    </td>
                    <td className="px-2 py-2">
                      {r.google_place_id ? (
                        <a
                          href={`https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(r.google_place_id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline"
                          title="View on Google Maps"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <button
                        type="button"
                        onClick={() => openEdit(r)}
                        className="rounded bg-slate-800 px-2 py-1 text-xs text-white hover:bg-slate-700"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length === 0 ? (
              <p className="p-6 text-center text-slate-500">
                No listings match filters.
              </p>
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
      </section>

      {regions.length > 0 ? (
        <section className="mt-8 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <h2 className="text-lg font-medium text-slate-200">By region</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead className="border-b border-slate-800 text-slate-400">
                <tr>
                  <th className="py-2 pr-4 font-medium">Region</th>
                  <th className="py-2 pr-4 font-medium">Count</th>
                  <th className="py-2 font-medium">Last scrape</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {regions.map((r) => (
                  <tr key={r.name}>
                    <td className="py-2 text-white">{r.name}</td>
                    <td className="py-2 text-slate-400">{r.count}</td>
                    <td className="py-2 text-slate-500">
                      {r.last_scrape ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {editing ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-4 sm:items-center">
          <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
            <h2 className="text-lg font-medium text-white">{editing.name}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {editing.address ?? ""}
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400">
                  Contact status
                </label>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                >
                  {CONTACT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300">
                <input
                  type="checkbox"
                  checked={editConverted}
                  onChange={(e) => setEditConverted(e.target.checked)}
                  className="rounded border-slate-600"
                />
                Converted to lead
              </label>
              <div>
                <label className="block text-xs font-medium text-slate-400">
                  Notes
                </label>
                <textarea
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  rows={4}
                  className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
            </div>
            <div className="mt-6 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveEdit()}
                className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save"}
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

      {confirmDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 shadow-xl">
            <h3 className="text-base font-semibold text-white">Confirm delete</h3>
            <p className="mt-2 text-sm text-slate-300">
              This will permanently delete <span className="font-semibold">{confirmDelete.label}</span>{" "}
              listing(s). This cannot be undone.
            </p>
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={deleting}
                onClick={() => setConfirmDelete(null)}
                className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleting}
                onClick={() => {
                  const mode = confirmDelete.mode;
                  setConfirmDelete(null);
                  if (mode === "selected") {
                    void runBulkDelete(confirmDelete.ids, "selected listings");
                    return;
                  }
                  void (async () => {
                    setDeleting(true);
                    try {
                      setScrapeMsg("Scanning filtered listings…");
                      const ids = await fetchAllFilteredIds();
                      if (ids.length === 0) {
                        setScrapeMsg("Nothing to delete.");
                        return;
                      }
                      await runBulkDelete(ids, "filtered listings");
                    } catch (e) {
                      const msg =
                        e instanceof Error ? e.message : "Delete failed";
                      setScrapeMsg(msg);
                    } finally {
                      setDeleting(false);
                    }
                  })();
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
              >
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
