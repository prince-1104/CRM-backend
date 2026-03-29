import { NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

export async function POST(request: Request) {
  let body: { token?: string; password?: string };
  try {
    body = (await request.json()) as { token?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const apiBase =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const res = await fetch(`${apiBase}/api/admin/bootstrap/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: body.token ?? "",
      password: body.password ?? "",
    }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
    let message = "Could not complete setup";
    const d = data.detail;
    if (typeof d === "string") message = d;
    else if (Array.isArray(d) && d.length > 0) {
      const first = d[0] as { msg?: string };
      if (typeof first?.msg === "string") message = first.msg;
    }
    return NextResponse.json({ error: message }, { status: res.status });
  }

  const data = (await res.json()) as { access_token: string };
  const out = NextResponse.json({ ok: true });
  out.cookies.set(COOKIE_NAME, data.access_token, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24,
  });
  return out;
}
