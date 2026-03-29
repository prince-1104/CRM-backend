import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

function backendBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

/**
 * One browser request: regions, categories, maps stats, and paginated listings
 * (parallel on server).
 */
export async function GET(request: NextRequest) {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const listingQs = request.nextUrl.searchParams.toString();
  const base = backendBase();
  const headers = { Authorization: `Bearer ${token}` };

  const [rRes, cRes, sRes, bRes] = await Promise.all([
    fetch(`${base}/api/admin/maps/regions`, { headers, cache: "no-store" }),
    fetch(`${base}/api/admin/maps/categories`, { headers, cache: "no-store" }),
    fetch(`${base}/api/admin/maps/stats`, { headers, cache: "no-store" }),
    fetch(
      `${base}/api/admin/maps-businesses${listingQs ? `?${listingQs}` : ""}`,
      { headers, cache: "no-store" },
    ),
  ]);

  if (!rRes.ok) {
    return NextResponse.json(await rRes.json().catch(() => ({})), {
      status: rRes.status,
    });
  }
  if (!cRes.ok) {
    return NextResponse.json(await cRes.json().catch(() => ({})), {
      status: cRes.status,
    });
  }
  if (!sRes.ok) {
    return NextResponse.json(await sRes.json().catch(() => ({})), {
      status: sRes.status,
    });
  }
  if (!bRes.ok) {
    return NextResponse.json(await bRes.json().catch(() => ({})), {
      status: bRes.status,
    });
  }

  const [regions, categories, stats, listings] = await Promise.all([
    rRes.json(),
    cRes.json(),
    sRes.json(),
    bRes.json(),
  ]);

  return NextResponse.json({
    regions,
    categories,
    stats,
    listings,
  });
}
