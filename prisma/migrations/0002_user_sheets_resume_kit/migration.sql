-- AlterTable
ALTER TABLE "Application" ADD COLUMN     "sheetId" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sheetId" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "ResumeTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumeTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResumePrompt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ResumePrompt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResumeTemplate_userId_idx" ON "ResumeTemplate"("userId");

-- CreateIndex
CREATE INDEX "ResumePrompt_userId_idx" ON "ResumePrompt"("userId");

-- AddForeignKey
ALTER TABLE "ResumeTemplate" ADD CONSTRAINT "ResumeTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResumePrompt" ADD CONSTRAINT "ResumePrompt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Keep the new tables out of Supabase's public Data API (see 0001_init).
ALTER TABLE "ResumeTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ResumePrompt" ENABLE ROW LEVEL SECURITY;
