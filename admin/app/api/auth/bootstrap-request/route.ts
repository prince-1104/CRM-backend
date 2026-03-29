import { NextResponse } from "next/server";

export async function POST(request: Request) {
  let body: { email?: string; bootstrap_secret?: string };
  try {
    body = (await request.json()) as {
      email?: string;
      bootstrap_secret?: string;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const apiBase =
    process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
  const res = await fetch(`${apiBase}/api/admin/bootstrap/request`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: body.email ?? "",
      bootstrap_secret: body.bootstrap_secret ?? "",
    }),
  });

  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { detail?: unknown };
    let message = "Request failed";
    const d = data.detail;
    if (typeof d === "string") message = d;
    else if (Array.isArray(d) && d.length > 0) {
      const first = d[0] as { msg?: string };
      if (typeof first?.msg === "string") message = first.msg;
    }
    return NextResponse.json({ error: message }, { status: res.status });
  }

  return NextResponse.json({ ok: true });
}
