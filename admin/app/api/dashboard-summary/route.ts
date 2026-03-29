import { cookies } from "next/headers";
import { NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

function backendBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

/** One browser request: lead stats, maps stats, recent leads (parallel on server). */
export async function GET() {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const base = backendBase();
  const headers = { Authorization: `Bearer ${token}` };

  const [sRes, mRes, lRes] = await Promise.all([
    fetch(`${base}/api/admin/leads/stats`, { headers, cache: "no-store" }),
    fetch(`${base}/api/admin/maps/stats`, { headers, cache: "no-store" }),
    fetch(`${base}/api/admin/leads?page=1&limit=5&sort=-created_at`, {
      headers,
      cache: "no-store",
    }),
  ]);

  if (!sRes.ok) {
    return NextResponse.json(await sRes.json().catch(() => ({})), {
      status: sRes.status,
    });
  }
  if (!mRes.ok) {
    return NextResponse.json(await mRes.json().catch(() => ({})), {
      status: mRes.status,
    });
  }
  if (!lRes.ok) {
    return NextResponse.json(await lRes.json().catch(() => ({})), {
      status: lRes.status,
    });
  }

  const [lead_stats, maps_stats, leadsPayload] = await Promise.all([
    sRes.json(),
    mRes.json(),
    lRes.json(),
  ]);

  return NextResponse.json({
    lead_stats,
    maps_stats,
    recent_leads:
      (leadsPayload as { data?: unknown }).data ?? [],
  });
}
