import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

function backendBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

/** One browser request: paginated leads + team + stats (parallel on server). */
export async function GET(request: NextRequest) {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const qs = request.nextUrl.searchParams.toString();
  const q = qs ? `?${qs}` : "";
  const base = backendBase();
  const headers = { Authorization: `Bearer ${token}` };

  const [lRes, tRes, sRes] = await Promise.all([
    fetch(`${base}/api/admin/leads${q}`, { headers, cache: "no-store" }),
    fetch(`${base}/api/admin/team-members`, { headers, cache: "no-store" }),
    fetch(`${base}/api/admin/leads/stats`, { headers, cache: "no-store" }),
  ]);

  if (!lRes.ok) {
    return NextResponse.json(await lRes.json().catch(() => ({})), {
      status: lRes.status,
    });
  }
  if (!tRes.ok) {
    return NextResponse.json(await tRes.json().catch(() => ({})), {
      status: tRes.status,
    });
  }
  if (!sRes.ok) {
    return NextResponse.json(await sRes.json().catch(() => ({})), {
      status: sRes.status,
    });
  }

  const [listing, team, stats] = await Promise.all([
    lRes.json(),
    tRes.json(),
    sRes.json(),
  ]);

  return NextResponse.json({
    ...(listing as object),
    team,
    stats,
  });
}
