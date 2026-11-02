import "server-only";
import { NextResponse } from "next/server";
import { getBearerUser, type SessionUser } from "./auth";
import { errorMessage, UserFacingError } from "./applications";
import { SheetNotConfiguredError } from "./sheets";
import { ResumeStorageError } from "./storage";
import { z } from "zod";

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** Wraps an extension route: resolves the bearer user and turns thrown errors into JSON. */
export function extRoute<C>(handler: (request: Request, user: SessionUser, context: C) => Promise<Response>) {
  return async (request: Request, context: C) => {
    const user = await getBearerUser(request);
    if (!user) return apiError("Not signed in or your access was revoked. Sign in again.", 401);
    try {
      return await handler(request, user, context);
    } catch (error) {
      if (error instanceof SheetNotConfiguredError) return apiError(error.message, 503);
      if (error instanceof ResumeStorageError) return apiError(error.message, 502);
      const known = error instanceof UserFacingError || error instanceof z.ZodError;
      return apiError(errorMessage(error), known ? 400 : 500);
    }
  };
}
