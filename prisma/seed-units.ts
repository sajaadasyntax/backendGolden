import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const UNITS = [
  { name: "Half Liter", nameAr: "نصف لتر", symbol: "0.5L" },
  { name: "250 ml", nameAr: "250 مل", symbol: "250ml" },
  { name: "100 ml", nameAr: "100 مل", symbol: "100ml" },
  { name: "50 ml", nameAr: "50 مل", symbol: "50ml" },
  { name: "10 ml", nameAr: "10 مل", symbol: "10ml" },
  { name: "1 ml", nameAr: "1 مل", symbol: "1ml" },
  { name: "Half Kilogram", nameAr: "نصف كيلوغرام", symbol: "0.5kg" },
  { name: "20 gram", nameAr: "20 جرام", symbol: "20g" },
  { name: "100 gram", nameAr: "100 جرام", symbol: "100g" },
  { name: "1 gram", nameAr: "1 جرام", symbol: "1g" },
  { name: "Vial", nameAr: "قارورة", symbol: "vial" },
];

async function main() {
  console.log("🌱 Seeding units...");

  for (const u of UNITS) {
    const existing = await prisma.unit.findFirst({
      where: { symbol: u.symbol },
    });

    if (existing) {
      console.log(`   ⏭️  ${u.name} (${u.symbol}) already exists, skipping`);
    } else {
      await prisma.unit.create({
        data: u,
      });
      console.log(`   ✓ Created: ${u.name} (${u.symbol})`);
    }
  }

  console.log("\n✅ Units seeded successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
