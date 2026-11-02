import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { STARTER_PROMPT } from "../src/lib/resume-prompts";

const db = new PrismaClient();

const DEFAULT_STAGES = [
  { name: "Applied", color: "#3b82f6", isDefault: true },
  { name: "Screening Interview", color: "#8b5cf6" },
  { name: "Technical Interview", color: "#f59e0b" },
  { name: "Final Interview", color: "#ec4899" },
  { name: "Offer", color: "#10b981" },
  { name: "Rejected", color: "#ef4444" },
  { name: "Withdrawn", color: "#64748b" },
];

async function main() {
  if ((await db.stage.count()) === 0) {
    for (const [order, stage] of DEFAULT_STAGES.entries()) {
      await db.stage.create({ data: { ...stage, order } });
    }
    console.log(`Created ${DEFAULT_STAGES.length} default stages`);
  }

  const email = (process.env.SEED_OWNER_EMAIL || "owner@example.com").trim().toLowerCase();
  const password = process.env.SEED_OWNER_PASSWORD || "ChangeMe123!";
  const name = process.env.SEED_OWNER_NAME || "Platform Owner";
  const existing = await db.user.findUnique({ where: { email } });
  if (!existing) {
    await db.user.create({
      data: { email, name, role: "OWNER", passwordHash: await bcrypt.hash(password, 10) },
    });
    console.log(`Created owner account ${email}`);
  } else {
    console.log(`Owner account ${email} already exists`);
  }

  if ((await db.resumePrompt.count()) === 0) {
    const owner = await db.user.findUniqueOrThrow({ where: { email } });
    await db.resumePrompt.create({
      data: { userId: owner.id, name: "Tailor resume to job (starter)", body: STARTER_PROMPT, shared: true, isDefault: true },
    });
    console.log("Created shared starter resume prompt");
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
