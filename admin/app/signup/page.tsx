"use client";

import Link from "next/link";
import { useState } from "react";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [bootstrapSecret, setBootstrapSecret] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/bootstrap-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          bootstrap_secret: bootstrapSecret,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        setError(j.error ?? "Could not send setup email");
        return;
      }
      setSuccess(true);
      setBootstrapSecret("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-slate-800 bg-slate-900/80 p-8 shadow-xl">
        <h1 className="text-center text-2xl font-semibold text-white">
          Star Uniform Admin
        </h1>
        <p className="mt-1 text-center text-sm text-slate-400">
          Create the first admin account
        </p>
        <p className="mt-3 text-center text-xs leading-relaxed text-slate-500">
          Only works while no admin exists. You need the one-time setup code from
          your server configuration. We will email you a link to choose a password.
        </p>
        <form onSubmit={onSubmit} className="mt-8 space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-slate-300"
            >
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none ring-blue-500 focus:ring-2"
              required
            />
          </div>
          <div>
            <label
              htmlFor="setup-code"
              className="block text-sm font-medium text-slate-300"
            >
              Setup code
            </label>
            <input
              id="setup-code"
              type="password"
              autoComplete="new-password"
              value={bootstrapSecret}
              onChange={(e) => setBootstrapSecret(e.target.value)}
              className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-white outline-none ring-blue-500 focus:ring-2"
              required
              minLength={1}
              placeholder="ADMIN_BOOTSTRAP_SECRET from server"
            />
          </div>
          {error ? (
            <p className="text-sm text-red-400" role="alert">
              {error}
            </p>
          ) : null}
          {success ? (
            <p className="text-sm text-emerald-400" role="status">
              If your details were correct, check <strong>{email}</strong> for a
              link to finish setup. The link expires in about an hour.
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:opacity-50"
          >
            {loading ? "Sending…" : "Send setup link"}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-slate-500">
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-medium text-blue-400 hover:text-blue-300"
          >
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
