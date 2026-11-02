/** Runs once when a server instance starts. */
export async function register() {
  // This exact form lets the bundler leave the Node-only module out of the Edge build.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
