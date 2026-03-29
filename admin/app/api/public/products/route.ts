import { NextResponse } from "next/server";

function backendBase(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
}

export async function GET() {
  try {
    const res = await fetch(`${backendBase()}/api/public/products`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return NextResponse.json(
        { detail: "Failed to load products" },
        { status: res.status },
      );
    }

    const data = await res.json();
    return NextResponse.json(data, { status: 200 });
  } catch {
    return NextResponse.json(
      { detail: "Backend unavailable" },
      { status: 503 },
    );
  }
}
