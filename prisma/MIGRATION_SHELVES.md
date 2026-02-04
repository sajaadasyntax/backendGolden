# Shelf Assignment Migration Guide

This guide explains how to migrate existing `SHELF_SALES` users to have their own assigned shelves.

## Overview

After applying the schema migration that adds the `userId` field to the `Shelf` model, existing `SHELF_SALES` users won't automatically have shelves assigned. This migration script creates shelves for all existing `SHELF_SALES` users who don't have one.

## Prerequisites

1. **Apply the schema migration first:**
   ```bash
   npm run db:migrate
   ```
   This will create the migration `20260126094529_add_user_shelf_relationship` which adds the `userId` column to the `shelves` table.

## Running the Migration Script

### Option 1: Using npm script (Recommended)
```bash
npm run db:migrate-shelves
```

### Option 2: Direct execution
```bash
npx tsx prisma/migrate-shelves.ts
```

## What the Script Does

1. **Finds all `SHELF_SALES` users** who don't have an active shelf assigned
2. **Creates a shelf for each user** with:
   - Unique shelf code (based on user ID)
   - Shelf name: `"{User Name}'s Shelf"`
   - Arabic name: `"رف {User Name}"`
   - Links the shelf to the user via `userId`
3. **Handles edge cases:**
   - Skips users who already have shelves
   - Generates unique shelf codes if conflicts occur
   - Provides detailed logging of the process

## Expected Output

```
🔄 Starting shelf assignment migration...
📋 Found 3 SHELF_SALES users without shelves
✅ Created shelf "John Doe's Shelf" (SH-ABC12345) for user john@golden.com
✅ Created shelf "Jane Smith's Shelf" (SH-DEF67890) for user jane@golden.com
✅ Created shelf "Bob Wilson's Shelf" (SH-GHI11111) for user bob@golden.com

📊 Migration Summary:
   ✅ Created: 3 shelves
   ⏭️  Skipped: 0 users (already had shelves)
   ❌ Errors: 0 users

✅ Migration completed successfully!
```

## Troubleshooting

### Error: "Foreign key constraint violation"
- **Cause:** The migration script is trying to create a shelf for a user that doesn't exist
- **Solution:** Ensure all users in the database are valid before running the script

### Error: "Unique constraint violation on shelf code"
- **Cause:** Shelf code generation created a duplicate
- **Solution:** The script automatically handles this by appending a counter. If it still fails, check for manual shelf entries with conflicting codes.

### No shelves created
- **Cause:** All `SHELF_SALES` users already have shelves assigned
- **Solution:** This is expected behavior. The script will report "All SHELF_SALES users already have shelves assigned"

## Verification

After running the migration, verify the results:

```sql
-- Check all SHELF_SALES users and their shelves
SELECT 
  u.email,
  u.name,
  s.name as shelf_name,
  s.code as shelf_code
FROM users u
LEFT JOIN shelves s ON s."userId" = u.id AND s."isActive" = true
WHERE u.role = 'SHELF_SALES'
ORDER BY u.email;
```

All `SHELF_SALES` users should have a shelf assigned.

## Notes

- The script is **idempotent** - it's safe to run multiple times
- It only creates shelves for users who don't have one
- Existing shelves are not modified
- The script uses transactions to ensure data consistency
