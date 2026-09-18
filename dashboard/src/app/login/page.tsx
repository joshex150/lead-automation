"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { RiLoader4Line, RiLockPasswordLine } from "react-icons/ri";
import { LogoMark } from "@/components/Logo";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? "Could not sign in");
        return;
      }
      // A full navigation, not a client push: the middleware has to see the new
      // cookie before it decides what to render.
      window.location.href = params.get("next") || "/overview";
    } catch {
      setError("Could not reach the dashboard server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh w-full items-center justify-center p-4">
      <div className="glass-card w-full max-w-sm border-t-4 border-t-brand-600 p-6 sm:p-8">
        <LogoMark className="h-12 w-12 text-ink" title="YEAN Technologies" />
        <h1 className="mt-5 font-heading text-2xl font-extrabold tracking-tight">
          YEAN<span className="text-brand-600"> Leads</span>
        </h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Sign in to reach the lead workspace.</p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div>
            <label className="label" htmlFor="username">Username</label>
            <input
              id="username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password"
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          {error && (
            <p role="alert" className="border border-rose-500/40 bg-rose-500/5 p-3 text-sm text-rose-600">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
            {busy ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiLockPasswordLine className="h-4 w-4" />}
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
