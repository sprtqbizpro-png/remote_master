"use client";

import { useState, useTransition } from "react";
import { Button, ErrorText, Field, Input } from "@/components/ui";
import { saveAutofillSettingsAction } from "../actions";

export function AutofillSettings({ model, defaultModel, hasKey }: { model: string; defaultModel: string; hasKey: boolean }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const value = String(new FormData(e.currentTarget).get("model") ?? "");
        start(async () => {
          const res = await saveAutofillSettingsAction({ model: value });
          if (!res.ok) return setError(res.error);
          setError("");
          setMessage(res.message ?? "Saved.");
        });
      }}
    >
      <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
        <span className="text-slate-500">OpenAI API key: </span>
        {hasKey ? (
          <span className="text-emerald-700">Configured</span>
        ) : (
          <span className="text-amber-700">Not set. Add OPENAI_API_KEY to the platform&apos;s environment and restart (or redeploy).</span>
        )}
      </div>
      <Field label="Model" hint={`Leave empty for the default (${defaultModel}).`}>
        <Input name="model" defaultValue={model} placeholder={defaultModel} />
      </Field>
      <ErrorText>{error}</ErrorText>
      {message && !error && <p className="text-sm text-emerald-700">{message}</p>}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
