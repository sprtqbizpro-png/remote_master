"use client";

import { useRouter } from "next/navigation";
import { useEffect, useTransition } from "react";
import { Button } from "@/components/ui";

/**
 * Shown when a page fails to load, most often because the database was briefly unreachable. The
 * session is still valid, so this offers a retry instead of sending the user back to sign in.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => console.error(error), [error]);
  const retry = () =>
    start(() => {
      router.refresh();
      reset();
    });
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center">
      <h1 className="text-base font-semibold text-slate-900">This page couldn&apos;t load</h1>
      <p className="mt-2 text-sm text-slate-500">
        The platform couldn&apos;t reach its database for a moment. You&apos;re still signed in. Try again.
      </p>
      <Button className="mt-4" onClick={retry} disabled={pending}>
        {pending ? "Retrying…" : "Try again"}
      </Button>
      {error.digest && <p className="mt-3 text-xs text-slate-400">Error reference: {error.digest}</p>}
    </div>
  );
}
