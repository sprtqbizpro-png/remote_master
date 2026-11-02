-- Lists sort applications by date: per applier (their own list) and across everyone (owners).
CREATE INDEX "Application_userId_appliedAt_idx" ON "Application"("userId", "appliedAt");

CREATE INDEX "Application_appliedAt_idx" ON "Application"("appliedAt");
