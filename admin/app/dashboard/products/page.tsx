"use client";

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter, useSearchParams } from "next/navigation";

type CatalogProduct = {
  id: number;
  sku: string;
  name: string;
  category: string | null;
  description: string | null;
  image_url: string | null;
  active: boolean;
};

const emptyForm = {
  sku: "",
  name: "",
  category: "",
  description: "",
  image_url: "",
  active: true,
};

/** Uppercase alphanumeric slug from catalogue label (e.g. "Catering" → CATERING). */
function catalogueLabelToSkuPrefix(label: string): string {
  const compact = label.replace(/[^a-zA-Z0-9]+/g, "").toUpperCase();
  if (!compact) return "ITEM";
  return compact.slice(0, 24);
}

/** Next SKU for a catalogue: count existing rows in that category + 1. */
function suggestedSkuForCategory(
  category: string,
  products: CatalogProduct[],
  skuPrefixByCategoryLower: Map<string, string>,
): string {
  const trimmed = category.trim();
  const prefix =
    skuPrefixByCategoryLower.get(trimmed.toLowerCase()) ??
    catalogueLabelToSkuPrefix(trimmed);
  const count = products.filter(
    (p) => (p.category ?? "").trim() === trimmed,
  ).length;
  return `${prefix}-${count + 1}`;
}

/** R2 uploads use keys like `catalog/<uuid>.jpg`. */
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

type FormState = typeof emptyForm;

type CatalogueCardDto = {
  name: string;
  sku_prefix: string;
};

type ProductFormBlockProps = {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  editingId: number | null;
  products: CatalogProduct[];
  skuPrefixByCategoryLower: Map<string, string>;
  message: string | null;
  saving: boolean;
  uploading: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  categorySelectOptions: string[];
  onUploadFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  showCancel: boolean;
};

function ProductFormBlock({
  form,
  setForm,
  editingId,
  products,
  skuPrefixByCategoryLower,
  message,
  saving,
  uploading,
  fileInputRef,
  categorySelectOptions,
  onUploadFile,
  onSubmit,
  onCancel,
  showCancel,
}: ProductFormBlockProps) {
  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-4">
      <div>
        <label className="block text-xs font-medium text-on-surface-variant">
          SKU
        </label>
        <input
          value={form.sku}
          onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
          className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none ring-primary/40 focus:ring-2"
          required
        />
        <p className="mt-1 text-xs text-on-surface-variant">
          Must stay unique across the catalog.
          {editingId == null ? (
            <>
              {" "}
              Choosing a catalogue fills a suggested code; you can edit it.
            </>
          ) : null}
        </p>
      </div>
      <div>
        <label className="block text-xs font-medium text-on-surface-variant">
          Name
        </label>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none ring-primary/40 focus:ring-2"
          required
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-on-surface-variant">
          Catalogue
        </label>
        <select
          value={form.category}
          onChange={(e) => {
            const category = e.target.value;
            setForm((f) => {
              const next = { ...f, category };
              if (editingId == null && category.trim()) {
                next.sku = suggestedSkuForCategory(
                  category,
                  products,
                  skuPrefixByCategoryLower,
                );
              }
              return next;
            });
          }}
          className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none ring-primary/40 focus:ring-2"
        >
          <option value="">Select catalogue…</option>
          {categorySelectOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-on-surface-variant">
          Controls the category label and filter on the public catalog.
        </p>
      </div>
      <div>
        <label className="block text-xs font-medium text-on-surface-variant">
          Description
        </label>
        <textarea
          value={form.description}
          onChange={(e) =>
            setForm((f) => ({ ...f, description: e.target.value }))
          }
          rows={3}
          className="mt-1 w-full resize-y rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none ring-primary/40 focus:ring-2"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-on-surface-variant">
          Product image
        </label>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={onUploadFile}
          />
          <button
            type="button"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="rounded-lg bg-surface-container-high px-3 py-2 text-sm text-on-surface transition-colors hover:bg-surface-container-highest disabled:opacity-50"
          >
            {uploading ? "Uploading…" : "Choose image & upload"}
          </button>
          {form.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={adminCatalogImageSrc(form.image_url) ?? form.image_url}
              alt="Preview"
              className="h-14 w-20 rounded border border-outline-variant object-cover"
            />
          ) : null}
        </div>
        <p className="mt-2 text-xs text-on-surface-variant">
          JPG, PNG, WebP, or GIF, max 10MB. URL is filled after upload.
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-on-surface-variant">
          Image URL (after upload or paste CDN URL)
        </label>
        <input
          value={form.image_url}
          onChange={(e) =>
            setForm((f) => ({ ...f, image_url: e.target.value }))
          }
          className="mt-1 w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2 font-mono text-xs text-on-surface-variant outline-none ring-primary/40 focus:ring-2"
        />
      </div>

      <label className="flex items-center gap-2 text-sm text-on-surface">
        <input
          type="checkbox"
          checked={form.active}
          onChange={(e) =>
            setForm((f) => ({ ...f, active: e.target.checked }))
          }
          className="rounded border-outline-variant bg-surface-container-low"
        />
        Active (visible on public catalog)
      </label>

      {message ? (
        <p
          className={`text-sm ${
            message.includes("failed") ||
            message.includes("Failed") ||
            message.includes("required") ||
            message.includes("already exists")
              ? "text-error"
              : "text-tertiary"
          }`}
        >
          {message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-gradient-to-r from-primary to-primary-dim px-5 py-2 text-sm font-bold text-on-primary shadow-[0_4px_20px_rgba(161,250,255,0.25)] transition-transform active:scale-[0.98] disabled:opacity-50"
        >
          {saving ? "Saving…" : editingId != null ? "Update" : "Create"}
        </button>
        {showCancel ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-outline-variant px-4 py-2 text-sm text-on-surface-variant hover:bg-surface-container-high"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}

function ProductsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [catalogCategories, setCatalogCategories] = useState<string[]>([]);
  const [catalogueCards, setCatalogueCards] = useState<CatalogueCardDto[]>([]);
  const [imageLightbox, setImageLightbox] = useState<{
    src: string;
    alt: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const skuPrefixByCategoryLower = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of catalogueCards) {
      m.set(c.name.trim().toLowerCase(), c.sku_prefix.trim());
    }
    return m;
  }, [catalogueCards]);

  const catalogueFilterRaw = (searchParams.get("catalogue") ?? "").trim();

  const productsForTable = useMemo(() => {
    if (!catalogueFilterRaw) return products;
    const q = catalogueFilterRaw.toLowerCase();
    return products.filter(
      (p) => (p.category ?? "").trim().toLowerCase() === q,
    );
  }, [products, catalogueFilterRaw]);

  const loadProducts = useCallback(async () => {
    setError(null);
    const res = await fetch("/api/admin-proxy/catalog/products", {
      cache: "no-store",
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { detail?: string };
      setError(j.detail ?? "Failed to load products");
      setProducts([]);
      return;
    }
    const data = (await res.json()) as CatalogProduct[];
    setProducts(Array.isArray(data) ? data : []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin-proxy/catalog/categories", {
        cache: "no-store",
      });
      if (cancelled || !res.ok) return;
      const data = (await res.json()) as string[];
      if (Array.isArray(data)) setCatalogCategories(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await fetch("/api/admin-proxy/catalog/catalogues", {
        cache: "no-store",
      });
      if (cancelled || !res.ok) return;
      const data = (await res.json()) as CatalogueCardDto[];
      if (Array.isArray(data)) {
        setCatalogueCards(
          data.map((c) => ({ name: c.name, sku_prefix: c.sku_prefix })),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const categorySelectOptions = useMemo(() => {
    const merged = new Set(catalogCategories);
    for (const p of products) {
      if (p.category) merged.add(p.category);
    }
    return Array.from(merged).sort((a, b) => a.localeCompare(b));
  }, [catalogCategories, products]);

  const catalogueFilterOptions = useMemo(() => {
    const merged = [...categorySelectOptions];
    if (
      catalogueFilterRaw &&
      !merged.some((c) => c.toLowerCase() === catalogueFilterRaw.toLowerCase())
    ) {
      merged.push(catalogueFilterRaw);
    }
    return merged.sort((a, b) => a.localeCompare(b));
  }, [categorySelectOptions, catalogueFilterRaw]);

  const activeCount = useMemo(
    () => products.filter((p) => p.active).length,
    [products],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadProducts();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadProducts]);

  useEffect(() => {
    if (searchParams.get("add") !== "1") return;
    setAddModalOpen(true);
    setEditingId(null);
    const cat = (searchParams.get("catalogue") ?? "").trim();
    setForm({ ...emptyForm, category: cat });
    setMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [searchParams]);

  function resetForm() {
    setForm(emptyForm);
    setEditingId(null);
    setMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  const closeAddModal = useCallback(() => {
    setAddModalOpen(false);
    const cat = (searchParams.get("catalogue") ?? "").trim();
    const path =
      cat.length > 0
        ? `/dashboard/products?catalogue=${encodeURIComponent(cat)}`
        : "/dashboard/products";
    router.replace(path, { scroll: false });
    setForm(emptyForm);
    setEditingId(null);
    setMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [router, searchParams]);

  const setCatalogueFilter = useCallback(
    (value: string) => {
      const trimmed = value.trim();
      if (!trimmed) {
        router.replace("/dashboard/products", { scroll: false });
        return;
      }
      router.replace(
        `/dashboard/products?catalogue=${encodeURIComponent(trimmed)}`,
        { scroll: false },
      );
    },
    [router],
  );

  useEffect(() => {
    if (!addModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAddModal();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addModalOpen, closeAddModal]);

  useEffect(() => {
    if (!imageLightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setImageLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [imageLightbox]);

  function openAddModal() {
    setEditingId(null);
    const cat = (searchParams.get("catalogue") ?? "").trim();
    setForm(cat ? { ...emptyForm, category: cat } : emptyForm);
    setMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setAddModalOpen(true);
    const path =
      cat.length > 0
        ? `/dashboard/products?add=1&catalogue=${encodeURIComponent(cat)}`
        : "/dashboard/products?add=1";
    router.replace(path, { scroll: false });
  }

  function startEdit(p: CatalogProduct) {
    setAddModalOpen(false);
    const cat = (searchParams.get("catalogue") ?? "").trim();
    const path =
      cat.length > 0
        ? `/dashboard/products?catalogue=${encodeURIComponent(cat)}`
        : "/dashboard/products";
    router.replace(path, { scroll: false });
    setEditingId(p.id);
    setForm({
      sku: p.sku,
      name: p.name,
      category: p.category ?? "",
      description: p.description ?? "",
      image_url: p.image_url ?? "",
      active: p.active,
    });
    setMessage(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function onUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMessage(null);
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
        setMessage(j.detail ?? "Upload failed");
        return;
      }
      if (j.url) {
        setForm((f) => ({ ...f, image_url: j.url as string }));
        setMessage("Image uploaded. Save the product to persist.");
      }
    } finally {
      setUploading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const payload = {
        sku: form.sku.trim(),
        name: form.name.trim(),
        category: form.category.trim() || null,
        description: form.description.trim() || null,
        image_url: form.image_url.trim() || null,
        active: form.active,
      };
      if (!payload.sku || !payload.name) {
        setMessage("SKU and name are required.");
        return;
      }

      const url =
        editingId != null
          ? `/api/admin-proxy/catalog/products/${editingId}`
          : "/api/admin-proxy/catalog/products";
      const method = editingId != null ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json().catch(() => ({}))) as { detail?: string };
      if (!res.ok) {
        setMessage(
          typeof j.detail === "string"
            ? j.detail
            : "Save failed (check SKU is unique).",
        );
        return;
      }
      setMessage(editingId != null ? "Product updated." : "Product created.");
      if (editingId == null) {
        closeAddModal();
      } else {
        resetForm();
      }
      await loadProducts();
      const cr = await fetch("/api/admin-proxy/catalog/catalogues", {
        cache: "no-store",
      });
      if (cr.ok) {
        const data = (await cr.json()) as CatalogueCardDto[];
        if (Array.isArray(data)) {
          setCatalogueCards(
            data.map((c) => ({ name: c.name, sku_prefix: c.sku_prefix })),
          );
        }
      }
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: number) {
    if (!confirm("Delete this product from the catalog?")) return;
    const res = await fetch(`/api/admin-proxy/catalog/products/${id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      setMessage("Delete failed.");
      return;
    }
    if (editingId === id) resetForm();
    setMessage("Product deleted.");
    await loadProducts();
  }

  return (
    <div>
      <header className="mb-10 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-headline text-4xl font-bold tracking-tight text-on-surface md:text-5xl">
            SKU inventory
          </h1>
          <p className="mt-2 max-w-2xl text-lg text-on-surface-variant">
            Catalog shown on the public site. Assign a catalogue per product,
            upload images to R2, then save. Manage catalogue names under{" "}
            <a
              href="/dashboard/catalog"
              className="text-primary underline decoration-primary/30 underline-offset-4 hover:text-primary-dim"
            >
              Catalogues
            </a>
            .
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-3 rounded-2xl bg-surface-container-low px-5 py-3">
            <div className="h-2 w-2 rounded-full bg-tertiary shadow-[0_0_10px_#bcff5f]" />
            <span className="font-headline text-xs uppercase tracking-widest text-tertiary">
              {activeCount} active
            </span>
          </div>
          <div className="rounded-2xl border border-outline-variant/30 bg-surface-container px-5 py-3 text-sm text-on-surface-variant">
            <span className="font-headline text-on-surface">{products.length}</span>{" "}
            products ·{" "}
            <span className="font-headline text-on-surface">
              {categorySelectOptions.length}
            </span>{" "}
            catalogues
          </div>
          <button
            type="button"
            onClick={openAddModal}
            className="flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-primary-dim px-5 py-2.5 font-headline text-sm font-bold text-on-primary shadow-[0_4px_20px_rgba(161,250,255,0.25)] transition-transform active:scale-[0.98]"
          >
            <span className="material-symbols-outlined text-lg text-on-primary">
              add
            </span>
            Add product
          </button>
        </div>
      </header>

      <div
        className={`grid gap-10 ${editingId != null ? "lg:grid-cols-[minmax(0,1fr)_380px]" : ""}`}
      >
        <section>
          <div className="mt-1 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <h2 className="font-headline text-lg font-semibold text-on-surface">
              Full catalog
            </h2>
            <div className="flex min-w-0 flex-col gap-1.5 sm:max-w-xs sm:shrink-0">
              <label
                htmlFor="catalogue-filter"
                className="text-xs font-medium text-on-surface-variant"
              >
                Filter by catalogue
              </label>
              <select
                id="catalogue-filter"
                value={catalogueFilterRaw}
                onChange={(e) => setCatalogueFilter(e.target.value)}
                disabled={loading}
                className="w-full rounded-lg border border-outline-variant bg-surface-container-low px-3 py-2.5 text-sm text-on-surface outline-none ring-primary/40 focus:ring-2 disabled:opacity-50"
              >
                <option value="">All catalogues</option>
                {catalogueFilterOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {loading ? (
            <p className="mt-4 text-on-surface-variant">Loading…</p>
          ) : error ? (
            <p className="mt-4 text-error">{error}</p>
          ) : (
            <div className="mt-4">
              {productsForTable.length === 0 ? (
                <div className="glass-card rounded-2xl border border-outline-variant/20 p-10 text-center text-on-surface-variant">
                  {catalogueFilterRaw
                    ? `No products in “${catalogueFilterRaw}”.`
                    : "No products yet."}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {productsForTable.map((p) => {
                    const imgSrc =
                      adminCatalogImageSrc(p.image_url) ?? p.image_url?.trim() ?? null;
                    return (
                      <article
                        key={p.id}
                        className="glass-card flex flex-col overflow-hidden rounded-2xl border border-outline-variant/20 bg-surface-container-low/20 shadow-[0_8px_30px_rgba(0,0,0,0.2)] transition hover:border-outline-variant/40"
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (imgSrc) {
                              setImageLightbox({ src: imgSrc, alt: p.name });
                            }
                          }}
                          disabled={!imgSrc}
                          className="group relative aspect-[4/3] w-full overflow-hidden bg-surface-container-highest outline-none ring-inset ring-primary/0 focus-visible:ring-2 disabled:cursor-default disabled:opacity-100"
                          aria-label={
                            imgSrc
                              ? `View full image: ${p.name}`
                              : "No image uploaded"
                          }
                        >
                          {imgSrc ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={imgSrc}
                              alt=""
                              className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03] group-focus-visible:scale-[1.03]"
                            />
                          ) : (
                            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-on-surface-variant">
                              <span className="material-symbols-outlined text-4xl opacity-40">
                                hide_image
                              </span>
                              <span className="text-xs">No image</span>
                            </div>
                          )}
                          {imgSrc ? (
                            <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/0 transition group-hover:bg-black/35 group-focus-visible:bg-black/35">
                              <span className="material-symbols-outlined scale-90 text-white opacity-0 drop-shadow-lg transition group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100">
                                zoom_in
                              </span>
                            </span>
                          ) : null}
                        </button>

                        <div className="flex flex-1 flex-col gap-3 p-4">
                          <div>
                            <p className="font-mono text-[11px] uppercase tracking-wide text-on-surface-variant">
                              {p.sku}
                            </p>
                            <h3 className="mt-1 font-headline text-base font-semibold leading-snug text-on-surface">
                              {p.name}
                            </h3>
                          </div>
                          <div className="flex flex-wrap items-center gap-2 text-xs text-on-surface-variant">
                            <span className="rounded-md bg-surface-container-high px-2 py-1">
                              {p.category ?? "Uncatalogued"}
                            </span>
                            <span
                              className={
                                p.active
                                  ? "rounded-md bg-tertiary/15 px-2 py-1 font-medium text-tertiary"
                                  : "rounded-md bg-on-surface/10 px-2 py-1 font-medium text-on-surface-variant"
                              }
                            >
                              {p.active ? "Active" : "Inactive"}
                            </span>
                          </div>
                          <div className="mt-auto flex flex-wrap gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() => startEdit(p)}
                              className="rounded-lg bg-surface-container-high px-3 py-1.5 text-xs font-medium text-on-surface transition-colors hover:bg-surface-container-highest"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void onDelete(p.id)}
                              className="rounded-lg bg-error/20 px-3 py-1.5 text-xs font-medium text-error hover:bg-error/30"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </section>

        {editingId != null ? (
          <section className="glass-card h-fit rounded-2xl border border-outline-variant/20 p-5 lg:sticky lg:top-28">
            <h2 className="font-headline text-lg font-semibold text-on-surface">
              Edit product
            </h2>
            <ProductFormBlock
              form={form}
              setForm={setForm}
              editingId={editingId}
              products={products}
              skuPrefixByCategoryLower={skuPrefixByCategoryLower}
              message={message}
              saving={saving}
              uploading={uploading}
              fileInputRef={fileInputRef}
              categorySelectOptions={categorySelectOptions}
              onUploadFile={onUploadFile}
              onSubmit={onSubmit}
              onCancel={resetForm}
              showCancel={
                Boolean(form.sku || form.name || form.description || form.image_url)
              }
            />
          </section>
        ) : null}
      </div>

      {imageLightbox ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Product image"
          onClick={() => setImageLightbox(null)}
        >
          <button
            type="button"
            onClick={() => setImageLightbox(null)}
            className="absolute right-4 top-4 rounded-lg bg-white/10 p-2 text-white transition hover:bg-white/20"
            aria-label="Close image"
          >
            <span className="material-symbols-outlined text-white">close</span>
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageLightbox.src}
            alt={imageLightbox.alt}
            className="max-h-[min(90vh,900px)] max-w-[min(96vw,1200px)] object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      ) : null}

      {addModalOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-product-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeAddModal();
          }}
        >
          <div
            className="glass-card max-h-[min(90vh,800px)] w-full max-w-lg overflow-y-auto rounded-2xl border border-outline-variant/30 p-6 shadow-[0_0_40px_rgba(0,0,0,0.5)]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2
                id="add-product-title"
                className="font-headline text-xl font-semibold text-on-surface"
              >
                Add product
              </h2>
              <button
                type="button"
                onClick={closeAddModal}
                className="rounded-lg p-1 text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface"
                aria-label="Close"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <ProductFormBlock
              form={form}
              setForm={setForm}
              editingId={null}
              products={products}
              skuPrefixByCategoryLower={skuPrefixByCategoryLower}
              message={message}
              saving={saving}
              uploading={uploading}
              fileInputRef={fileInputRef}
              categorySelectOptions={categorySelectOptions}
              onUploadFile={onUploadFile}
              onSubmit={onSubmit}
              onCancel={closeAddModal}
              showCancel
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[40vh] items-center justify-center text-on-surface-variant">
          Loading…
        </div>
      }
    >
      <ProductsPageInner />
    </Suspense>
  );
}
