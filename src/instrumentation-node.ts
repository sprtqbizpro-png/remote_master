// Node.js-only start-up work, loaded from instrumentation.ts. Kept in its own file so the Edge
// build never bundles the database client or the Google libraries (they need Node's fs, crypto, ...).
import { db, poolSize } from "./lib/db";
import { keepGoogleTokenWarm } from "./lib/google";

// A page runs several queries in parallel, one connection each. Opening a connection to the
// database can take 5-10 s over a long-distance link, so a page that finds only one open
// connection waits that long for the rest. Open the whole pool at start-up (in the background, so
// the server start isn't delayed) and ping every connection each minute so idle ones aren't dropped.
const warmPool = () => Promise.all(Array.from({ length: poolSize }, () => db.$queryRaw`select 1`.catch(() => undefined)));
warmPool();
setInterval(warmPool, 60_000).unref();
keepGoogleTokenWarm();
