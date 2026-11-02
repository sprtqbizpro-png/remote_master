import "server-only";
import { NextResponse } from "next/server";
import { AuthUnavailableError, getBearerUser, renewedBearerToken, type SessionUser } from "./auth";
import { errorMessage, UserFacingError } from "./applications";
import { SheetNotConfiguredError } from "./sheets";
import { ResumeStorageError } from "./storage";
import { z } from "zod";

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type ExtHandler<C> = (request: Request, user: SessionUser, context: C) => Promise<Response>;

/**
 * Wraps an extension route: resolves the bearer user and turns thrown errors into JSON. A database
 * outage answers 503 (the extension keeps its token); only a bad, expired or revoked token answers
 * 401. Tokens older than a day come back renewed in the X-RB-Token header.
 */
export function extRoute<C>(handler: ExtHandler<C>) {
  return async (request: Request, context: C) => {
    let user: SessionUser | null;
    try {
      user = await getBearerUser(request);
    } catch (error) {
      if (error instanceof AuthUnavailableError) return apiError(error.message, 503);
      throw error;
    }
    if (!user) return apiError("Not signed in or your access was revoked. Sign in again.", 401);
    const response = await run(handler, request, user, context);
    const renewed = await renewedBearerToken(request);
    if (renewed) {
      try {
        response.headers.set("x-rb-token", renewed);
      } catch {
        /* immutable headers: the token is renewed on a later request */
      }
    }
    return response;
  };
}

async function run<C>(handler: ExtHandler<C>, request: Request, user: SessionUser, context: C) {
  try {
    return await handler(request, user, context);
  } catch (error) {
    if (error instanceof SheetNotConfiguredError || error instanceof AuthUnavailableError) return apiError(error.message, 503);
    if (error instanceof ResumeStorageError) return apiError(error.message, 502);
    const known = error instanceof UserFacingError || error instanceof z.ZodError;
    return apiError(errorMessage(error), known ? 400 : 500);
  }
}
