"use client";

import { useState, useTransition } from "react";
import { Button, ErrorText, Field, Input } from "@/components/ui";
import { saveGoogleSettingsAction, testGoogleAction } from "../actions";

export function GoogleSettings({ sheetId, driveFolderId }: { sheetId: string; driveFolderId: string }) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [test, setTest] = useState<{ sheet: string; drive: string } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        start(async () => {
          const res = await saveGoogleSettingsAction({
            sheetId: String(f.get("sheetId")),
            driveFolderId: String(f.get("driveFolderId")),
          });
          setTest(null);
          if (!res.ok) return setError(res.error);
          setError("");
          setMessage(res.message ?? "Saved");
        });
      }}
    >
      <Field
        label="Default Google Sheet"
        hint="Used by appliers who have no sheet of their own (set per user under Users). Paste the spreadsheet URL or its ID."
      >
        <Input name="sheetId" defaultValue={sheetId} placeholder="https://docs.google.com/spreadsheets/d/…" />
      </Field>
      <Field label="Drive folder for resumes" hint="Paste the folder URL or its ID.">
        <Input name="driveFolderId" defaultValue={driveFolderId} placeholder="https://drive.google.com/drive/folders/…" />
      </Field>
      {sheetId && (
        <a
          href={`https://docs.google.com/spreadsheets/d/${sheetId}/edit`}
          target="_blank"
          rel="noreferrer"
          className="inline-block text-sm text-indigo-600 hover:underline"
        >
          Open spreadsheet ↗
        </a>
      )}
      <ErrorText>{error}</ErrorText>
      {message && !error && <p className="text-sm text-emerald-700">{message}</p>}
      {test && (
        <div className="space-y-1 rounded-md bg-slate-50 p-3 text-sm">
          <div>
            <span className="font-medium">Sheet:</span> {test.sheet}
          </div>
          <div>
            <span className="font-medium">Drive:</span> {test.drive}
          </div>
        </div>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          Save
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => start(async () => setTest(await testGoogleAction()))}
        >
          {pending ? "Working…" : "Test connection"}
        </Button>
      </div>
    </form>
  );
}
