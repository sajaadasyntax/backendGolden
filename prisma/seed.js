import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
const prisma = new PrismaClient();
async function main() {
    console.log("🌱 Seeding database...");
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
    const users = [
        { email: "warehouse@golden.com", name: "Warehouse Staff", nameAr: "موظف المخزن", role: "WAREHOUSE_SALES" },
        { email: "shelf@golden.com", name: "Shelf Staff", nameAr: "موظف الرف", role: "SHELF_SALES" },
        { email: "procurement@golden.com", name: "Procurement Staff", nameAr: "موظف المشتريات", role: "PROCUREMENT" },
        { email: "accountant@golden.com", name: "Accountant", nameAr: "المحاسب", role: "ACCOUNTANT" },
    ];
    for (const u of users) {
        await prisma.user.upsert({
            where: { email: u.email },
            update: {},
            create: {
                ...u,
                passwordHash,
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
    // Create shelf
    const shelf = await prisma.shelf.upsert({
        where: { code: "SH01" },
        update: {},
        create: {
            name: "Main Shelf",
            nameAr: "الرف الرئيسي",
            code: "SH01",
        },
    });
    console.log("✓ Created shelf:", shelf.name);
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
    const createdCategories = {};
    for (const c of categories) {
        const cat = await prisma.itemCategory.create({
            data: c,
        });
        createdCategories[c.name] = cat.id;
    }
    console.log("✓ Created categories");
    // Get first unit
    const pieceUnit = await prisma.unit.findFirst({ where: { symbol: "pc" } });
    // Create sample items
    const items = [
        { sku: "ELEC001", nameEn: "Smartphone", nameAr: "هاتف ذكي", category: "Electronics" },
        { sku: "ELEC002", nameEn: "Laptop", nameAr: "لابتوب", category: "Electronics" },
        { sku: "FOOD001", nameEn: "Coffee", nameAr: "قهوة", category: "Food & Beverages" },
        { sku: "FOOD002", nameEn: "Tea", nameAr: "شاي", category: "Food & Beverages" },
        { sku: "OFF001", nameEn: "Notebook", nameAr: "دفتر", category: "Office Supplies" },
        { sku: "GEN001", nameEn: "General Item", nameAr: "منتج عام", category: "General Merchandise" },
    ];
    for (const item of items) {
        const created = await prisma.item.upsert({
            where: { sku: item.sku },
            update: {},
            create: {
                sku: item.sku,
                nameEn: item.nameEn,
                nameAr: item.nameAr,
                categoryId: createdCategories[item.category],
                unitId: pieceUnit.id,
                minStockLevel: 10,
                maxStockLevel: 100,
            },
        });
        // Create price policy
        await prisma.pricePolicy.create({
            data: {
                itemId: created.id,
                branchId: mainBranch.id,
                wholesalePriceUsd: 50 + Math.random() * 100,
                retailPriceUsd: 60 + Math.random() * 120,
                priceRangeMinUsd: 45 + Math.random() * 50,
                priceRangeMaxUsd: 100 + Math.random() * 150,
                effectiveFrom: new Date(),
            },
        });
    }
    console.log("✓ Created items with price policies");
    // Create expense categories
    const expenseCategories = [
        { name: "Rent", nameAr: "إيجار" },
        { name: "Utilities", nameAr: "خدمات" },
        { name: "Salaries", nameAr: "رواتب" },
        { name: "Transportation", nameAr: "نقل" },
        { name: "Miscellaneous", nameAr: "متفرقات" },
    ];
    for (const ec of expenseCategories) {
        await prisma.expenseCategory.create({ data: ec });
    }
    console.log("✓ Created expense categories");
    // Create chart of accounts
    const accounts = [
        { code: "1000", nameEn: "Cash", nameAr: "نقد", accountType: "ASSET" },
        { code: "1100", nameEn: "Bank", nameAr: "بنك", accountType: "ASSET" },
        { code: "1200", nameEn: "Accounts Receivable", nameAr: "ذمم مدينة", accountType: "ASSET" },
        { code: "1300", nameEn: "Inventory", nameAr: "مخزون", accountType: "ASSET" },
        { code: "2000", nameEn: "Accounts Payable", nameAr: "ذمم دائنة", accountType: "LIABILITY" },
        { code: "3000", nameEn: "Owner's Equity", nameAr: "حقوق الملكية", accountType: "EQUITY" },
        { code: "4000", nameEn: "Sales Revenue", nameAr: "إيرادات المبيعات", accountType: "REVENUE" },
        { code: "5000", nameEn: "Cost of Goods Sold", nameAr: "تكلفة البضاعة المباعة", accountType: "EXPENSE" },
        { code: "5100", nameEn: "Operating Expenses", nameAr: "مصاريف تشغيلية", accountType: "EXPENSE" },
    ];
    for (const acc of accounts) {
        await prisma.account.upsert({
            where: { code: acc.code },
            update: {},
            create: acc,
        });
    }
    console.log("✓ Created chart of accounts");
    // Create sample suppliers
    const suppliers = [
        { name: "Tech Supplier Co.", nameAr: "شركة الموردين التقنية", phone: "+249111111111", isConsignor: false },
        { name: "Food Imports Ltd.", nameAr: "استيراد الأغذية المحدودة", phone: "+249222222222", isConsignor: false },
        { name: "General Trading", nameAr: "التجارة العامة", phone: "+249333333333", isConsignor: true },
    ];
    for (const s of suppliers) {
        await prisma.supplier.create({ data: s });
    }
    console.log("✓ Created suppliers");
    // Create sample customers
    const customers = [
        { name: "Retail Customer 1", nameAr: "عميل تجزئة 1", customerType: "RETAIL", creditLimitSdg: 0 },
        { name: "Wholesale Customer 1", nameAr: "عميل جملة 1", customerType: "WHOLESALE", creditLimitSdg: 50000 },
        { name: "Wholesale Customer 2", nameAr: "عميل جملة 2", customerType: "WHOLESALE", creditLimitSdg: 100000 },
    ];
    for (const c of customers) {
        await prisma.customer.create({ data: c });
    }
    console.log("✓ Created customers");
    console.log("\n✅ Database seeded successfully!");
    console.log("\n📋 Login credentials:");
    console.log("   Admin: admin@golden.com / admin123");
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
