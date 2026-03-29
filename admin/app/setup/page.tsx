import { Suspense } from "react";
import { SetupClient } from "./SetupClient";

export default function SetupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-slate-400">
          Loading…
        </div>
      }
    >
      <SetupClient />
    </Suspense>
  );
}
