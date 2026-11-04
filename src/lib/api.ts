import "server-only";
import { NextResponse } from "next/server";
import { withCurrentSuspension, assertCanApply, AuthUnavailableError, CannotApplyError, getBearerAuth, removedMessage, renewedBearerToken, suspensionMessage, type SessionUser } from "./auth";
import { errorMessage, UserFacingError } from "./applications";
import { SheetNotConfiguredError } from "./sheets";
import { ResumeStorageError } from "./storage";
import { z } from "zod";

export function apiError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

type ExtHandler<C> = (request: Request, user: SessionUser, context: C) => Promise<Response>;

/** A refusal the extension recognises by `code` (it shows the message and stops applying). */
function refusal(code: string, message: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

type ExtOptions = {
  /** Usable while suspended (signing in, reading your own profile). Everything else is refused. */
  allowSuspended?: boolean;
  /** Applies (saves, autofills, writes the sheet): re-checked against the database, not the cache. */
  applies?: boolean;
};

/**
 * Wraps an extension route: resolves the bearer user and turns thrown errors into JSON. A database
 * outage answers 503 (the extension keeps its token); only a bad, expired or revoked token answers
 * 401. A deleted account answers 401 with code "deleted", a suspended one 403 with code
 * "suspended", each with a message telling the applier to contact the owner. Tokens older than a
 * day come back renewed in the X-RB-Token header.
 */
export function extRoute<C>(handler: ExtHandler<C>, options: ExtOptions = {}) {
  return async (request: Request, context: C) => {
    let user: SessionUser | null;
    let reason: string;
    try {
      ({ user, reason } = await getBearerAuth(request));
    } catch (error) {
      if (error instanceof AuthUnavailableError) return apiError(error.message, 503);
      throw error;
    }
    if (!user) {
      if (reason === "deleted") return refusal("deleted", await removedMessage(), 401);
      if (reason === "disabled") return refusal("disabled", "Your account has been deactivated by the platform owner. Contact them to restore access.", 401);
      return apiError("Not signed in or your access was revoked. Sign in again.", 401);
    }
    user = await withCurrentSuspension(user);
    if (user.suspended && !options.allowSuspended) return refusal("suspended", await suspensionMessage(user.suspendedReason), 403);
    if (options.applies) {
      try {
        await assertCanApply(user);
      } catch (error) {
        if (error instanceof CannotApplyError) return refusal(error.code, error.message, error.code === "suspended" ? 403 : 401);
        if (error instanceof AuthUnavailableError) return apiError(error.message, 503);
        throw error;
      }
    }
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
    if (error instanceof CannotApplyError) return refusal(error.code, error.message, error.code === "suspended" ? 403 : 401);
    if (error instanceof ResumeStorageError) return apiError(error.message, 502);
    const known = error instanceof UserFacingError || error instanceof z.ZodError;
    return apiError(errorMessage(error), known ? 400 : 500);
  }
}
