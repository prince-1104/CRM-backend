"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type CatalogueCard = {
  id: number | null;
  name: string;
  sku_prefix: string;
  cover_image_url: string | null;
  badge_label: string | null;
  cta_label: string | null;
  sort_order: number;
  product_count: number;
  preview_product_names: string[];
};

type CatalogProductRow = {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  active: boolean;
};

const emptyForm = {
  name: "",
  sku_prefix: "",
  cover_image_url: "",
  badge_label: "",
  cta_label: "",
  sort_order: 0,
};

function catalogueLabelToSkuPrefix(label: string): string {
  const compact = label.replace(/[^a-zA-Z0-9]+/g, "").toUpperCase();
  if (!compact) return "ITEM";
  return compact.slice(0, 24);
}

function catalogKeyFromImageUrl(imageUrl: string): string | null {
  try {
    const path = new URL(imageUrl).pathname;
    const m = path.match(/\/(catalog\/[^/]+)$/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function adminCatalogImageSrc(imageUrl: string | null | undefined): string | null {
  if (!imageUrl?.trim()) return null;
  const trimmed = imageUrl.trim();
  const key = catalogKeyFromImageUrl(trimmed);
  if (!key) return trimmed;
  const path = key.split("/").map(encodeURIComponent).join("/");
  return `/api/admin-proxy/catalog/media/${path}`;
}

const badgeRing = [
  "bg-violet-500/30 text-violet-100 ring-violet-400/25",
  "bg-emerald-500/30 text-emerald-100 ring-emerald-400/25",
  "bg-sky-500/30 text-sky-100 ring-sky-400/25",
];

const cardMesh = [
  "from-slate-900/95 via-slate-800/90 to-zinc-950/95",
  "from-zinc-950/95 via-slate-900/90 to-neutral-950/95",
  "from-neutral-950/95 via-zinc-900/90 to-slate-950/95",
];

export default function CatalogPage() {
  const [cards, setCards] = useState<CatalogueCard[]>([]);
  const [products, setProducts] = useState<CatalogProductRow[]>([]);
  const [productsError, setProductsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [collectionView, setCollectionView] = useState<CatalogueCard | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [lockName, setLockName] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "err"; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadCards = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin-proxy/catalog/catalogues", {
      cache: "no-store",
    });
    if (!res.ok) {
      setError("Could not load catalogues.");
      setCards([]);
      return;
    }
    const data = (await res.json()) as CatalogueCard[];
    setCards(Array.isArray(data) ? data : []);
  }, []);

  const loadProducts = useCallback(async () => {
    setProductsError(null);
    const res = await fetch("/api/admin-proxy/catalog/products", {
      cache: "no-store",
    });
    if (!res.ok) {
      setProductsError("Could not load products.");
      setProducts([]);
      return;
    }
    const data = (await res.json()) as CatalogProductRow[];
    setProducts(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    void loadCards();
    void loadProducts();
  }, [loadCards, loadProducts]);

  const collectionProducts = useMemo(() => {
    if (!collectionView) return [];
    const q = collectionView.name.trim().toLowerCase();
    return products
      .filter((p) => (p.category ?? "").trim().toLowerCase() === q)
      .sort((a, b) => a.sku.localeCompare(b.sku));
  }, [products, collectionView]);

  const nextSortDefault = useMemo(() => {
    if (cards.length === 0) return 0;
    return Math.max(...cards.map((c) => c.sort_order)) + 1;
  }, [cards]);

  function openAdd() {
    setNotice(null);
    setLockName(false);
    setForm({ ...emptyForm, sort_order: nextSortDefault });
    setModalOpen(true);
    if (fileRef.current) fileRef.current.value = "";
  }

  function openEdit(c: CatalogueCard) {
    setNotice(null);
    setLockName(true);
    setForm({
      name: c.name,
      sku_prefix: c.sku_prefix,
      cover_image_url: c.cover_image_url ?? "",
      badge_label: c.badge_label ?? "",
      cta_label: c.cta_label ?? "",
      sort_order: c.sort_order,
    });
    setModalOpen(true);
    if (fileRef.current) fileRef.current.value = "";
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/admin-proxy/catalog/upload-image", {
        method: "POST",
        body: fd,
      });
      const j = (await res.json().catch(() => ({}))) as {
        url?: string;
        detail?: string;
      };
      if (!res.ok) {
        setNotice({ tone: "err", text: j.detail ?? "Upload failed" });
        return;
      }
      if (j.url) setForm((f) => ({ ...f, cover_image_url: j.url as string }));
    } finally {
      setUploading(false);
    }
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    if (!name) {
      setNotice({ tone: "err", text: "Catalogue name is required." });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const res = await fetch("/api/admin-proxy/catalog/catalogues", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          sku_prefix: form.sku_prefix.trim(),
          cover_image_url: form.cover_image_url.trim() || null,
          badge_label: form.badge_label.trim() || null,
          cta_label: form.cta_label.trim() || null,
          sort_order: form.sort_order,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) {
        setNotice({
          tone: "err",
          text: typeof j.detail === "string" ? j.detail : "Save failed",
        });
        return;
      }
      setNotice({ tone: "ok", text: "Saved." });
      await loadCards();
      await loadProducts();
      setModalOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function onDeleteCard(c: CatalogueCard) {
    if (c.id == null) {
      setNotice({
        tone: "err",
        text: "No saved profile for this catalogue—nothing to delete.",
      });
      return;
    }
    if (
      !confirm(
        `Remove saved showcase settings for “${c.name}”? Products keep their catalogue tag.`,
      )
    ) {
      return;
    }
    const res = await fetch(`/api/admin-proxy/catalog/catalogues/${c.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setNotice({ tone: "err", text: "Delete failed." });
      return;
    }
    setNotice({ tone: "ok", text: "Removed." });
    await loadCards();
    await loadProducts();
  }

  function openCollection(c: CatalogueCard) {
    void loadProducts();
    setCollectionView(c);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (collectionView) {
        setCollectionView(null);
        return;
      }
      if (modalOpen) setModalOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen, collectionView]);

  return (
    <div className="relative pb-28">
      <header className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface md:text-5xl">
            Catalogues
          </h1>
          <p className="mt-2 max-w-2xl text-on-surface-variant">
            Configure cover art, client card badge, CTA copy, and the SKU prefix used when
            adding products. Cards below match the public site showcase. Assign SKUs under{" "}
            <Link
              href="/dashboard/products"
              className="text-primary underline decoration-primary/30 underline-offset-4 hover:text-primary-dim"
            >
              Products
            </Link>
            .
          </p>
        </div>
      </header>

      {error ? <p className="text-error">{error}</p> : null}
      {notice && !modalOpen && !collectionView ? (
        <p
          className={`mb-6 text-sm ${notice.tone === "ok" ? "text-tertiary" : "text-error"}`}
        >
          {notice.text}
        </p>
      ) : null}

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c, i) => {
          const cover = adminCatalogImageSrc(c.cover_image_url);
          const badge =
            (c.badge_label && c.badge_label.trim()) || c.name.toUpperCase().slice(0, 18);
          const cta = (c.cta_label && c.cta_label.trim()) || "View collection";
          const previews =
            c.preview_product_names.length > 0
              ? c.preview_product_names
              : ["No products yet", "—", "—"];
          const mesh = cardMesh[i % cardMesh.length];
          const badgeClass = badgeRing[i % badgeRing.length];

          return (
            <article
              key={`${c.name}-${i}`}
              className="group relative flex min-h-[400px] flex-col overflow-hidden rounded-3xl border border-outline-variant/25 bg-surface-container-low/30 shadow-[0_20px_50px_rgba(0,0,0,0.35)] ring-1 ring-white/5 transition duration-300 hover:-translate-y-0.5 hover:ring-primary/20"
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${mesh}`} />
              {cover ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={cover}
                  alt=""
                  className="absolute inset-0 h-full w-full object-cover brightness-[0.38] saturate-[0.65] transition duration-500 group-hover:brightness-[0.48]"
                />
              ) : null}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/20" />

              <div className="relative z-10 flex h-full flex-col p-6">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <span
                    className={`inline-flex max-w-[min(100%,220px)] rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest ring-1 ${badgeClass}`}
                  >
                    {badge}
                  </span>
                  <span className="rounded-full border border-white/15 bg-black/30 px-2.5 py-0.5 font-headline text-[10px] uppercase tracking-wider text-on-primary/90">
                    {c.product_count} SKU
                  </span>
                </div>

                <div className="mt-auto">
                  <h2 className="text-3xl font-black uppercase tracking-tight text-white drop-shadow">
                    {c.name}
                  </h2>
                  <p className="mt-1 font-mono text-[11px] text-cyan-200/80">
                    Prefix: {c.sku_prefix}
                  </p>
                  <ul className="mt-4 space-y-1.5 text-sm text-slate-200/90">
                    {previews.slice(0, 3).map((line) => (
                      <li key={line} className="flex gap-2">
                        <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary/90" />
                        <span>{line}</span>
                      </li>
                    ))}
                  </ul>

                  <button
                    type="button"
                    onClick={() => openCollection(c)}
                    className="mt-5 flex w-full items-center justify-center gap-2 rounded-2xl border border-white/20 bg-black/35 px-4 py-3 text-xs font-bold uppercase tracking-widest text-white/90 backdrop-blur-sm transition hover:border-primary/50 hover:bg-black/50"
                  >
                    {cta}
                    <span
                      className="material-symbols-outlined text-base text-primary-dim"
                      aria-hidden
                    >
                      arrow_forward
                    </span>
                  </button>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openEdit(c)}
                      className="rounded-full bg-gradient-to-r from-primary to-primary-dim px-4 py-2 font-headline text-xs font-bold text-on-primary shadow-[0_4px_20px_rgba(161,250,255,0.2)]"
                    >
                      Edit
                    </button>
                    {c.id != null ? (
                      <button
                        type="button"
                        onClick={() => void onDeleteCard(c)}
                        className="rounded-full border border-outline-variant px-4 py-2 text-xs text-on-surface-variant hover:bg-surface-container-high"
                      >
                        Delete profile
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      {cards.length === 0 && !error ? (
        <p className="mt-8 text-center text-on-surface-variant">No catalogues loaded.</p>
      ) : null}

      <button
        type="button"
        onClick={openAdd}
        className="fixed bottom-8 right-8 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-cyan-400 text-on-primary shadow-[0_0_28px_rgba(34,211,238,0.45)] transition hover:scale-105 active:scale-95"
        aria-label="Add catalogue"
      >
        <span className="material-symbols-outlined text-2xl">add</span>
      </button>

      {collectionView ? (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="collection-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCollectionView(null);
          }}
        >
          <div
            className="glass-card flex max-h-[min(85vh,720px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-outline-variant/30 shadow-[0_0_40px_rgba(0,0,0,0.55)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-outline-variant/25 p-5">
              <div>
                <h2
                  id="collection-modal-title"
                  className="font-headline text-lg font-semibold text-on-surface"
                >
                  {collectionView.name}
                </h2>
                <p className="mt-1 text-xs text-on-surface-variant">
                  Products and SKUs in this catalogue ({collectionProducts.length})
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCollectionView(null)}
                className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container-high"
                aria-label="Close"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              {productsError ? (
                <p className="text-sm text-error">{productsError}</p>
              ) : collectionProducts.length === 0 ? (
                <p className="text-sm text-on-surface-variant">
                  No products in this catalogue yet. Add SKUs under Products.
                </p>
              ) : (
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 border-b border-outline-variant/30 bg-surface-container-highest/90 text-on-surface-variant backdrop-blur-sm">
                    <tr>
                      <th className="py-2 pr-3 font-medium">SKU</th>
                      <th className="py-2 pr-3 font-medium">Name</th>
                      <th className="py-2 font-medium">Active</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/20">
                    {collectionProducts.map((p) => (
                      <tr key={p.id} className="text-on-surface">
                        <td className="py-2.5 pr-3 font-mono text-xs text-on-surface-variant">
                          {p.sku}
                        </td>
                        <td className="py-2.5 pr-3">{p.name}</td>
                        <td className="py-2.5 text-on-surface-variant">
                          {p.active ? "Yes" : "No"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="shrink-0 border-t border-outline-variant/25 p-4">
              <Link
                href={`/dashboard/products?catalogue=${encodeURIComponent(collectionView.name)}`}
                scroll={false}
                className="text-sm text-primary underline decoration-primary/30 underline-offset-2 hover:text-primary-dim"
              >
                Open in Products page
              </Link>
            </div>
          </div>
        </div>
      ) : null}

      {modalOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="catalogue-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            className="glass-card max-h-[min(92vh,820px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-outline-variant/30 p-6 shadow-[0_0_40px_rgba(0,0,0,0.55)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <h2
                id="catalogue-modal-title"
                className="font-headline text-xl font-semibold text-on-surface"
              >
                {lockName ? "Edit catalogue showcase" : "New catalogue"}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1 text-on-surface-variant hover:bg-surface-container-high"
                aria-label="Close"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={(e) => void onSave(e)} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-on-surface-variant">
                  Catalogue name
                </label>
                <input
                  value={form.name}
                  disabled={lockName}
                  onChange={(e) => {
                    const name = e.target.value;
                    setForm((f) => ({
                      ...f,
                      name,
                      sku_prefix: lockName
                        ? f.sku_prefix
                        : catalogueLabelToSkuPrefix(name),
                    }));
                  }}
                  placeholder="e.g. Chef, Spa, Front office"
                  maxLength={100}
                  className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none ring-primary/40 focus:ring-2 disabled:opacity-60"
                />
                <p className="mt-1 text-xs text-on-surface-variant">
                  Must match the catalogue tag on products. New names are created when you save.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant">
                  SKU name format (prefix)
                </label>
                <input
                  value={form.sku_prefix}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, sku_prefix: e.target.value }))
                  }
                  maxLength={24}
                  className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-mono text-sm text-on-surface outline-none ring-primary/40 focus:ring-2"
                />
                <p className="mt-1 text-xs text-on-surface-variant">
                  Suggested from the name; editable. Product SKUs use{" "}
                  <span className="font-mono">{`PREFIX-#`}</span>.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant">
                  Cover photo
                </label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) => void onUpload(e)}
                />
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileRef.current?.click()}
                    className="rounded-lg bg-surface-container-high px-3 py-2 text-sm text-on-surface hover:bg-surface-container-highest disabled:opacity-50"
                  >
                    {uploading ? "Uploading…" : "Upload image"}
                  </button>
                  {form.cover_image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={adminCatalogImageSrc(form.cover_image_url) ?? form.cover_image_url}
                      alt=""
                      className="h-16 w-24 rounded-lg border border-outline-variant object-cover"
                    />
                  ) : null}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant">
                  Client card badge
                </label>
                <input
                  value={form.badge_label}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, badge_label: e.target.value }))
                  }
                  placeholder="e.g. Premium collection"
                  maxLength={80}
                  className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none ring-primary/40 focus:ring-2"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant">
                  Button label (client UI)
                </label>
                <input
                  value={form.cta_label}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, cta_label: e.target.value }))
                  }
                  placeholder="View collection"
                  maxLength={80}
                  className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none ring-primary/40 focus:ring-2"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-on-surface-variant">
                  Sort order
                </label>
                <input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      sort_order: Number(e.target.value) || 0,
                    }))
                  }
                  className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none ring-primary/40 focus:ring-2"
                />
              </div>

              {notice && modalOpen ? (
                <p
                  className={`text-sm ${notice.tone === "ok" ? "text-tertiary" : "text-error"}`}
                >
                  {notice.text}
                </p>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-2">
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-full bg-gradient-to-r from-primary to-primary-dim px-5 py-2 font-headline text-sm font-bold text-on-primary shadow-[0_4px_20px_rgba(161,250,255,0.25)] disabled:opacity-50"
                >
                  {saving ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-outline-variant px-4 py-2 text-sm text-on-surface-variant hover:bg-surface-container-high"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
