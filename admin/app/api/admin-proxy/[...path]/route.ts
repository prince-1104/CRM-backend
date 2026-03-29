import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";

const COOKIE_NAME = "admin_token";

function backendBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

async function proxy(request: NextRequest, pathSegments: string[]) {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) {
    return NextResponse.json({ detail: "Not authenticated" }, { status: 401 });
  }

  const subPath = pathSegments.join("/");
  const target = new URL(`${backendBase()}/api/admin/${subPath}`);
  target.search = request.nextUrl.search;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  const ct = request.headers.get("content-type");
  if (ct) headers["Content-Type"] = ct;

  let body: ArrayBuffer | undefined;
  if (!["GET", "HEAD"].includes(request.method)) {
    body = await request.arrayBuffer();
  }

  const res = await fetch(target.toString(), {
    method: request.method,
    headers,
    body: body && body.byteLength > 0 ? body : undefined,
  });

  const out = new Headers();
  const forward = [
    "content-type",
    "content-disposition",
    "content-length",
  ] as const;
  for (const name of forward) {
    const v = res.headers.get(name);
    if (v) out.set(name, v);
  }

  return new NextResponse(res.body, {
    status: res.status,
    headers: out,
  });
}

type RouteCtx = { params: { path: string[] } };

export async function GET(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx.params.path);
}

export async function POST(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx.params.path);
}

export async function PATCH(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx.params.path);
}

export async function PUT(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx.params.path);
}

export async function DELETE(request: NextRequest, ctx: RouteCtx) {
  return proxy(request, ctx.params.path);
}
