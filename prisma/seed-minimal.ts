import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database (minimal)...");

  // Create branches
  const mainBranch = await prisma.branch.upsert({
    where: { code: "MAIN" },
    update: {},
    create: {
      name: "Main Branch",
      nameAr: "الفرع الرئيسي",
      code: "MAIN",
      address: "Khartoum, Sudan",
      phone: "+249123456789",
    },
  });

  console.log("✓ Created branch:", mainBranch.name);

  // Create admin user
  const passwordHash = await bcrypt.hash("admin123", 12);
  const adminUser = await prisma.user.upsert({
    where: { email: "admin@golden.com" },
    update: {},
    create: {
      email: "admin@golden.com",
      passwordHash,
      name: "Admin User",
      nameAr: "المدير",
      role: "ADMIN",
      branchId: mainBranch.id,
    },
  });

  console.log("✓ Created admin user:", adminUser.email);

  // Create other users
  const kassalaPasswordHash = await bcrypt.hash("k12345", 12);
  const users = [
    { email: "warehouse@golden.com", name: "Warehouse Staff", nameAr: "موظف المخزن", role: "WAREHOUSE_SALES" as const, passwordHash },
    { email: "shelf@golden.com", name: "Shelf Staff", nameAr: "موظف الرف", role: "SHELF_SALES" as const, passwordHash },
    { email: "kassala@golden.com", name: "Kassala", nameAr: "كسلا", role: "SHELF_SALES" as const, passwordHash: kassalaPasswordHash },
    { email: "procurement@golden.com", name: "Procurement Staff", nameAr: "موظف المشتريات", role: "PROCUREMENT" as const, passwordHash },
    { email: "accountant@golden.com", name: "Accountant", nameAr: "المحاسب", role: "ACCOUNTANT" as const, passwordHash },
  ];

  for (const u of users) {
    const { passwordHash: uHash, ...rest } = u;
    await prisma.user.upsert({
      where: { email: rest.email },
      update: {},
      create: {
        ...rest,
        passwordHash: uHash,
        branchId: mainBranch.id,
      },
    });
  }

  console.log("✓ Created staff users");

  // Create warehouse
  const warehouse = await prisma.warehouse.upsert({
    where: { code: "WH01" },
    update: {},
    create: {
      name: "Main Warehouse",
      nameAr: "المخزن الرئيسي",
      code: "WH01",
    },
  });

  console.log("✓ Created warehouse:", warehouse.name);

  // Create shelves and link to shelf users
  const shelfUser = await prisma.user.findUnique({ where: { email: "shelf@golden.com" } });
  const shelf = await prisma.shelf.upsert({
    where: { code: "SH01" },
    update: {},
    create: {
      name: "Main Shelf",
      nameAr: "الرف الرئيسي",
      code: "SH01",
      ...(shelfUser ? { userId: shelfUser.id } : {}),
    },
  });

  console.log("✓ Created shelf:", shelf.name);

  const kassalaUser = await prisma.user.findUnique({ where: { email: "kassala@golden.com" } });
  const kassalaShelf = await prisma.shelf.upsert({
    where: { code: "SH-KASSALA" },
    update: {},
    create: {
      name: "Kassala Shelf",
      nameAr: "رف كسلا",
      code: "SH-KASSALA",
      ...(kassalaUser ? { userId: kassalaUser.id } : {}),
    },
  });

  console.log("✓ Created shelf:", kassalaShelf.name);

  // Create units
  const units = [
    { name: "Piece", nameAr: "قطعة", symbol: "pc" },
    { name: "Kilogram", nameAr: "كيلوغرام", symbol: "kg" },
    { name: "Liter", nameAr: "لتر", symbol: "L" },
    { name: "Box", nameAr: "صندوق", symbol: "box" },
    { name: "Carton", nameAr: "كرتون", symbol: "ctn" },
  ];

  for (const u of units) {
    await prisma.unit.upsert({
      where: { id: u.symbol },
      update: {},
      create: u,
    });
  }

  console.log("✓ Created units");

  // Create categories
  const categories = [
    { name: "Electronics", nameAr: "إلكترونيات" },
    { name: "Food & Beverages", nameAr: "أغذية ومشروبات" },
    { name: "Clothing", nameAr: "ملابس" },
    { name: "Office Supplies", nameAr: "مستلزمات مكتبية" },
    { name: "General Merchandise", nameAr: "بضائع عامة" },
  ];

  for (const c of categories) {
    await prisma.itemCategory.create({
      data: c,
    });
  }

  console.log("✓ Created categories");

  console.log("\n✅ Database seeded successfully (minimal)!");
  console.log("\n📋 Login credentials:");
  console.log("   Admin: admin@golden.com / admin123");
  console.log("   Kassala (shelf): kassala@golden.com / k123");
  console.log("   All other users use the same password: admin123");
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
