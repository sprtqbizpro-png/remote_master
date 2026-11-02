// Node.js-only start-up work, loaded from instrumentation.ts. Kept in its own file so the Edge
// build never bundles the database client or the Google libraries (they need Node's fs, crypto, ...).
import { db, poolSize, serverless } from "./lib/db";
import { keepGoogleTokenWarm } from "./lib/google";

// A long-running server: a page runs several queries in parallel, one connection each, and opening
// a connection can take 5-10 s over a long-distance link, so open the whole pool at start-up (in
// the background) and ping every connection each minute so idle ones aren't dropped.
// Not on serverless: there each instance would hold connections open while frozen between
// requests, and a few instances would use up every slot the database pooler allows.
if (!serverless) {
  const warmPool = () => Promise.all(Array.from({ length: poolSize }, () => db.$queryRaw`select 1`.catch(() => undefined)));
  warmPool();
  setInterval(warmPool, 60_000).unref();
  keepGoogleTokenWarm();
}
