import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Migration script to auto-create shelves for existing SHELF_SALES users
 * Run this after applying the schema migration that adds userId to Shelf model
 * 
 * Usage: npx tsx prisma/migrate-shelves.ts
 */
async function main() {
  console.log("🔄 Starting shelf assignment migration...");

  try {
    // Find all SHELF_SALES users
    const allShelfSalesUsers = await prisma.user.findMany({
      where: {
        role: "SHELF_SALES",
      },
      include: {
        shelf: {
          where: {
            isActive: true,
          },
        },
      },
    });

    // Filter to only users without shelves
    const shelfSalesUsers = allShelfSalesUsers.filter(
      (user) => !user.shelf || user.shelf.length === 0
    );

    console.log(`📋 Found ${shelfSalesUsers.length} SHELF_SALES users without shelves`);

    if (shelfSalesUsers.length === 0) {
      console.log("✅ All SHELF_SALES users already have shelves assigned");
      return;
    }

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of shelfSalesUsers) {
      try {
        // Check if user already has a shelf (in case of race condition)
        const existingShelf = await prisma.shelf.findFirst({
          where: {
            userId: user.id,
            isActive: true,
          },
        });

        if (existingShelf) {
          console.log(`⏭️  User ${user.email} already has a shelf, skipping...`);
          skipped++;
          continue;
        }

        // Generate unique shelf code
        let shelfCode = `SH-${user.id.substring(0, 8).toUpperCase()}`;
        let counter = 1;

        // Check if code already exists and generate unique one
        while (
          await prisma.shelf.findUnique({
            where: {
              code: shelfCode,
            },
          })
        ) {
          shelfCode = `SH-${user.id.substring(0, 6).toUpperCase()}-${counter}`;
          counter++;
        }

        // Extract username from email (part before @)
        const username = user.email.split('@')[0];
        
        // Create shelf for user
        const shelf = await prisma.shelf.create({
          data: {
            userId: user.id,
            name: `${username}'s Shelf`,
            nameAr: `رف ${username}`,
            code: shelfCode,
            isActive: true,
          },
        });

        console.log(
          `✅ Created shelf "${shelf.name}" (${shelf.code}) for user ${user.email}`
        );
        created++;
      } catch (error: any) {
        console.error(
          `❌ Failed to create shelf for user ${user.email}:`,
          error.message
        );
        errors++;
      }
    }

    console.log("\n📊 Migration Summary:");
    console.log(`   ✅ Created: ${created} shelves`);
    console.log(`   ⏭️  Skipped: ${skipped} users (already had shelves)`);
    console.log(`   ❌ Errors: ${errors} users`);

    if (errors === 0) {
      console.log("\n✅ Migration completed successfully!");
    } else {
      console.log(
        `\n⚠️  Migration completed with ${errors} error(s). Please review the errors above.`
      );
    }
  } catch (error) {
    console.error("❌ Migration failed:", error);
    process.exit(1);
  }
}

main()
  .catch((e) => {
    console.error("❌ Unexpected error:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
