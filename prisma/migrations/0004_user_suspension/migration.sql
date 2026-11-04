-- Owners can suspend an applier: they can still sign in and look, but cannot apply.
ALTER TABLE "User" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "suspendedReason" TEXT NOT NULL DEFAULT '';
