import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** Pack size label from the price list → unit display name / symbol */
const SIZE_TO_UNIT: Record<
  string,
  { name: string; nameAr: string; symbol: string }
> = {
  "10 ml": { name: "10 ml", nameAr: "10 مل", symbol: "10ml" },
  "30 ml": { name: "30 ml", nameAr: "30 مل", symbol: "30ml" },
  "50 ml": { name: "50 ml", nameAr: "50 مل", symbol: "50ml" },
  "100 ml": { name: "100 ml", nameAr: "100 مل", symbol: "100ml" },
  "200 ml": { name: "200 ml", nameAr: "200 مل", symbol: "200ml" },
  "300 ml": { name: "300 ml", nameAr: "300 مل", symbol: "300ml" },
  "500 ml": { name: "500 ml", nameAr: "500 مل", symbol: "500ml" },
  "1000 ml": { name: "1000 ml", nameAr: "1000 مل", symbol: "1000ml" },
  "500 gm": { name: "500 gram", nameAr: "500 جرام", symbol: "500gm" },
  "1000 gm": { name: "1000 gram", nameAr: "1000 جرام", symbol: "1000gm" },
  "300 mg": { name: "300 mg", nameAr: "300 مجم", symbol: "300mg" },
  Box: { name: "Box", nameAr: "صندوق", symbol: "box" },
};

type Row = {
  nameEn: string;
  nameAr: string;
  sku: string;
  packSize: keyof typeof SIZE_TO_UNIT;
  wholesale: number;
  retail: number;
};

const ROWS: Row[] = [
  { nameEn: "Jiuding Ivermec 1%", nameAr: "ايفرمكتين جودن 1%", sku: "JIUD01", packSize: "10 ml", wholesale: 9000, retail: 15000 },
  { nameEn: "Jiuding Ivermec 1%", nameAr: "ايفرمكتين جودن 1%", sku: "JIUD02", packSize: "50 ml", wholesale: 2350, retail: 4000 },
  { nameEn: "Jiuding Ivermec 1%", nameAr: "ايفرمكتين جودن 1%", sku: "JIUD03", packSize: "100 ml", wholesale: 4000, retail: 7000 },
  { nameEn: "Jiuding Ivermec 2%", nameAr: "ايفرمكتين جودن 2%", sku: "JIUD04", packSize: "50 ml", wholesale: 4700, retail: 7000 },
  { nameEn: "Jiuding Dexa 0.2%", nameAr: "دكسا جودن 0.2%", sku: "JIUD05", packSize: "100 ml", wholesale: 7000, retail: 12000 },
  { nameEn: "Jiuding Dexa 0.2%", nameAr: "دكسا جودن 0.02%", sku: "JIUD06", packSize: "50 ml", wholesale: 4200, retail: 7000 },
  { nameEn: "Jiuding Tylosin 20%", nameAr: "تايلوزين جودن 20%", sku: "JIUD07", packSize: "50 ml", wholesale: 5900, retail: 10000 },
  { nameEn: "Jiuding Oxy 20%", nameAr: "اوكسي جودن 20%", sku: "JIUD08", packSize: "50 ml", wholesale: 4000, retail: 6000 },
  { nameEn: "Jiuding Oxy 5%", nameAr: "اوكسي جودن 5%", sku: "JIUD09", packSize: "100 ml", wholesale: 4000, retail: 7000 },
  { nameEn: "Jiuding Oxy 5%", nameAr: "اوكسي جودن 5%", sku: "JIUD10", packSize: "50 ml", wholesale: 2350, retail: 4000 },
  { nameEn: "Dipscal Syrup", nameAr: "ديبسكالسي شراب", sku: "JIUD11", packSize: "100 ml", wholesale: 2300, retail: 4000 },
  { nameEn: "Albendazole 2.5% Oral P.S.E", nameAr: "البندازول شراب 2.5% فارما سويد", sku: "SCC001", packSize: "500 ml", wholesale: 6900, retail: 12000 },
  { nameEn: "Dexaphan inj", nameAr: "دكسافان", sku: "SCC002", packSize: "50 ml", wholesale: 5000, retail: 8000 },
  { nameEn: "Imicarbizole P.S.E inj", nameAr: "ايميكاربزول فارما سويد", sku: "SCC003", packSize: "100 ml", wholesale: 32000, retail: 45000 },
  { nameEn: "Injectal 33.3% inj", nameAr: "انجكتال سلفا", sku: "SCC004", packSize: "100 ml", wholesale: 7200, retail: 12000 },
  { nameEn: "Oramectin Oral", nameAr: "ارومكتين شراب", sku: "SCC005", packSize: "1000 ml", wholesale: 11800, retail: 18000 },
  { nameEn: "Oramectin Oral", nameAr: "ارومكتين شراب", sku: "SCC006", packSize: "500 ml", wholesale: 6800, retail: 12000 },
  { nameEn: "Oxy vet pharma 20%", nameAr: "اوكسي فيت باودر 20%", sku: "SCC007", packSize: "1000 gm", wholesale: 48000, retail: 70000 },
  { nameEn: "Oxy vet pharma 20%", nameAr: "اوكسي فيت باودر 20%", sku: "SCC008", packSize: "500 gm", wholesale: 25500, retail: 35000 },
  { nameEn: "Spectropan 5% inj", nameAr: "اسبكتروبان 5%", sku: "SCC009", packSize: "50 ml", wholesale: 2450, retail: 4000 },
  { nameEn: "Tylovet 20% inj", nameAr: "تايلوفيت 20%", sku: "SCC010", packSize: "100 ml", wholesale: 12000, retail: 18000 },
  { nameEn: "Tylovet 20% inj", nameAr: "تايلوفيت 20%", sku: "SCC011", packSize: "50 ml", wholesale: 7000, retail: 12000 },
  { nameEn: "Levafluke Oral", nameAr: "ليفافلوك شراب", sku: "SCC012", packSize: "1000 ml", wholesale: 32000, retail: 45000 },
  { nameEn: "Levafluke Oral", nameAr: "ليفافلوك شراب", sku: "SCC013", packSize: "500 ml", wholesale: 17000, retail: 24000 },
  { nameEn: "Histacure inj", nameAr: "هيستاكيور", sku: "SCC014", packSize: "100 ml", wholesale: 16500, retail: 24000 },
  { nameEn: "Bloatryl Oral", nameAr: "بلوتريل", sku: "SCC015", packSize: "100 ml", wholesale: 5200, retail: 8000 },
  { nameEn: "Albevet Oral", nameAr: "البيفيت شراب", sku: "Kab001", packSize: "1000 ml", wholesale: 14000, retail: 24000 },
  { nameEn: "Albevet Oral", nameAr: "البيفيت شراب", sku: "Kab002", packSize: "500 ml", wholesale: 7900, retail: 12000 },
  { nameEn: "Butex inj", nameAr: "بيوتكس", sku: "Kab003", packSize: "50 ml", wholesale: 25000, retail: 35000 },
  { nameEn: "Diminavet Inj", nameAr: "دايمنوفيت", sku: "Kab004", packSize: "100 ml", wholesale: 9300, retail: 14000 },
  { nameEn: "Diminavet Inj", nameAr: "دايمنوفيت", sku: "Kab005", packSize: "50 ml", wholesale: 5300, retail: 8000 },
  { nameEn: "Enrovet Inj", nameAr: "انروفيت", sku: "Kab006", packSize: "100 ml", wholesale: 9400, retail: 14000 },
  { nameEn: "Enrovet Inj", nameAr: "انروفيت", sku: "Kab007", packSize: "50 ml", wholesale: 5400, retail: 8000 },
  { nameEn: "Multivitamin Inj", nameAr: "ملتي فيتامين الاردني", sku: "Kab008", packSize: "100 ml", wholesale: 10000, retail: 15000 },
  { nameEn: "Imicarb Inj", nameAr: "ايمكارب الاردني", sku: "Kab009", packSize: "100 ml", wholesale: 32000, retail: 45000 },
  { nameEn: "Oxymisole Plus Oral", nameAr: "اوكسيميزول بلس شراب", sku: "Kab010", packSize: "1000 ml", wholesale: 32000, retail: 45000 },
  { nameEn: "Tectin Inj", nameAr: "تكتين ايفرمكتين الاردني", sku: "Kab011", packSize: "100 ml", wholesale: 9400, retail: 14000 },
  { nameEn: "Tectin Inj", nameAr: "تكتين ايفرمكتين الاردني", sku: "Kab012", packSize: "50 ml", wholesale: 5400, retail: 8000 },
  { nameEn: "Oxytetravet Aerosole", nameAr: "اوكسيتترافيت بخاخ", sku: "Kab013", packSize: "200 ml", wholesale: 10000, retail: 14000 },
  { nameEn: "Buparva inj", nameAr: "بيوبارفا", sku: "SCC016", packSize: "50 ml", wholesale: 22000, retail: 32000 },
  { nameEn: "Floxanil 10% inj", nameAr: "فلوكسنيل 10%", sku: "SCC017", packSize: "100 ml", wholesale: 7000, retail: 12000 },
  { nameEn: "Floxanil 10% inj", nameAr: "فلوكسنيل 10%", sku: "SCC018", packSize: "50 ml", wholesale: 4000, retail: 6000 },
  { nameEn: "Oxynil 20% inj", nameAr: "اوكسينيل 20%", sku: "SCC019", packSize: "50 ml", wholesale: 4000, retail: 6000 },
  { nameEn: "Oxynil 5% inj", nameAr: "اوكسينيل 5%", sku: "SCC020", packSize: "100 ml", wholesale: 4200, retail: 7000 },
  { nameEn: "Oxynil 5% inj", nameAr: "اوكسينيل 5%", sku: "SCC021", packSize: "50 ml", wholesale: 2450, retail: 4000 },
  { nameEn: "Vitanil inj", nameAr: "فيتانيل فيتامين", sku: "SCC022", packSize: "100 ml", wholesale: 6000, retail: 9000 },
  { nameEn: "Vitanil inj", nameAr: "فيتانيل فيتامين", sku: "SCC023", packSize: "50 ml", wholesale: 4000, retail: 6000 },
  { nameEn: "Vitanil AD3E inj", nameAr: "فيتانيل AD3E فيتامين", sku: "SCC024", packSize: "50 ml", wholesale: 7500, retail: 12000 },
  { nameEn: "VitaBnil inj", nameAr: "فيتابنيل بي-كومبليكس فيتامين", sku: "SCC025", packSize: "100 ml", wholesale: 6000, retail: 9000 },
  { nameEn: "Albanil Bolus", nameAr: "البنيل حبوب", sku: "SCC026", packSize: "300 mg", wholesale: 8500, retail: 15000 },
  { nameEn: "Closanil Super Inj", nameAr: "كلوزانيل سيوبر", sku: "SCC027", packSize: "50 ml", wholesale: 8500, retail: 12000 },
  { nameEn: "Iminil Inj", nameAr: "ايمينيل ايميكاربزول", sku: "SCC028", packSize: "50 ml", wholesale: 12500, retail: 18000 },
  { nameEn: "Ketonil Inj", nameAr: "كيتونيل كيتوبروفين", sku: "SCC029", packSize: "50 ml", wholesale: 8500, retail: 12000 },
  { nameEn: "Sulfanil 33.3% Inj", nameAr: "سلفانيل سلفا 33.3%", sku: "SCC030", packSize: "100 ml", wholesale: 7000, retail: 12000 },
  { nameEn: "Diminil Plus", nameAr: "دايمنيل دايمزين ظروف", sku: "SCC031", packSize: "Box", wholesale: 12500, retail: 20000 },
  { nameEn: "Dicunil", nameAr: "دايكرونيل ظروف", sku: "SCC032", packSize: "Box", wholesale: 16000, retail: 25000 },
  { nameEn: "Alvenax Drench", nameAr: "الفناكس بندازول شراب", sku: "ASIMA1", packSize: "500 ml", wholesale: 7500, retail: 12000 },
  { nameEn: "Milfone C inj", nameAr: "ملفون سي درب", sku: "ASIMA2", packSize: "300 ml", wholesale: 12000, retail: 18000 },
  { nameEn: "Thiaprin inj", nameAr: "ثيابرين بي-كومبليكس", sku: "ASIMA3", packSize: "100 ml", wholesale: 7500, retail: 12000 },
  { nameEn: "Penivet Forte", nameAr: "بنيفيت فورت", sku: "ASIMA4", packSize: "30 ml", wholesale: 7500, retail: 12000 },
  { nameEn: "Dexavet", nameAr: "دكسافيت", sku: "ASIMA5", packSize: "50 ml", wholesale: 5500, retail: 8000 },
];

function normalizeNameEn(s: string): string {
  return s.replace(/\s*_\s*/g, " ").replace(/,\s*$/, "").trim();
}

async function ensureUnit(packSize: keyof typeof SIZE_TO_UNIT) {
  const def = SIZE_TO_UNIT[packSize];
  let unit = await prisma.unit.findFirst({ where: { symbol: def.symbol } });
  if (!unit) {
    unit = await prisma.unit.create({
      data: { name: def.name, nameAr: def.nameAr, symbol: def.symbol },
    });
  }
  return unit;
}

async function ensureCategory() {
  const name = "Veterinary & Pharmaceutical";
  const nameAr = "بيطري وصيدلاني";
  let cat = await prisma.itemCategory.findFirst({ where: { name } });
  if (!cat) {
    cat = await prisma.itemCategory.create({ data: { name, nameAr } });
  }
  return cat;
}

async function upsertBranchPolicy(
  itemId: string,
  branchId: string,
  wholesale: number,
  retail: number
) {
  const low = Math.min(wholesale, retail);
  const high = Math.max(wholesale, retail);
  const existing = await prisma.pricePolicy.findFirst({
    where: {
      itemId,
      branchId,
      warehouseId: null,
      shelfId: null,
    },
    orderBy: { effectiveFrom: "desc" },
  });

  const effectiveFrom = new Date();
  effectiveFrom.setHours(0, 0, 0, 0);

  if (existing) {
    await prisma.pricePolicy.update({
      where: { id: existing.id },
      data: {
        wholesalePriceUsd: wholesale,
        retailPriceUsd: retail,
        priceRangeMinUsd: low,
        priceRangeMaxUsd: high,
        effectiveFrom,
        effectiveTo: null,
      },
    });
  } else {
    await prisma.pricePolicy.create({
      data: {
        itemId,
        branchId,
        wholesalePriceUsd: wholesale,
        retailPriceUsd: retail,
        priceRangeMinUsd: low,
        priceRangeMaxUsd: high,
        effectiveFrom,
      },
    });
  }
}

async function main() {
  console.log("🌱 Seeding veterinary / pharmaceutical items...");

  const branch = await prisma.branch.findUnique({ where: { code: "MAIN" } });
  if (!branch) {
    throw new Error('Branch with code "MAIN" not found. Run prisma/seed.ts or seed-minimal.ts first.');
  }

  const category = await ensureCategory();
  let n = 0;

  for (const row of ROWS) {
    const nameEn = normalizeNameEn(row.nameEn);
    const unit = await ensureUnit(row.packSize);
    const description = `Pack: ${row.packSize}`;

    const item = await prisma.item.upsert({
      where: { sku: row.sku },
      create: {
        sku: row.sku,
        nameEn,
        nameAr: row.nameAr.trim(),
        description,
        categoryId: category.id,
        unitId: unit.id,
        minStockLevel: 0,
        maxStockLevel: null,
        isActive: true,
      },
      update: {
        nameEn,
        nameAr: row.nameAr.trim(),
        description,
        categoryId: category.id,
        unitId: unit.id,
        isActive: true,
      },
    });

    await upsertBranchPolicy(item.id, branch.id, row.wholesale, row.retail);
    n++;
    console.log(`   ✓ ${row.sku} — ${nameEn} (${row.packSize})`);
  }

  console.log(`\n✅ Seeded ${n} items with MAIN branch price policies.`);
}

main()
  .catch((e) => {
    console.error("❌ Seeding failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
