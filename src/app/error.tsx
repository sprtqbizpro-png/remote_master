"use client";

// Catches failures in the signed-in layout itself (its session check), which the (app) boundary
// can't: an error boundary only covers the segments below its own layout.
export { default } from "./(app)/error";
