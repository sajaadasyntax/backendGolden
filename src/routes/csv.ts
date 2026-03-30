import { Router, Request, Response } from "express";
import { verifyToken, validateSession, type JWTPayload } from "../lib/auth.js";
import prisma from "../lib/prisma.js";
import multer from "multer";

const csvRouter = Router();

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(new Error("Only CSV files are allowed"));
    }
  },
});

async function authenticateRequest(req: Request): Promise<JWTPayload | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7);
  const payload = await verifyToken(token);
  if (!payload) return null;
  const valid = await validateSession(payload.sessionId);
  return valid ? payload : null;
}

function requireRole(user: JWTPayload, roles: string[]): boolean {
  return roles.includes(user.role);
}

function escapeCsvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseCsv(content: string): { headers: string[]; rows: string[][] } {
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim());
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase().trim());
  const rows = lines.slice(1).map((l) => parseCsvLine(l));
  return { headers, rows };
}

// ── EXPORT ITEMS ──────────────────────────────────────────────
csvRouter.get("/csv/items/export", async (req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (!requireRole(user, ["ADMIN", "MANAGER", "PROCUREMENT"])) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const items = await prisma.item.findMany({
      include: { category: true, unit: true },
      orderBy: { sku: "asc" },
    });

    const header = ["SKU", "Name (EN)", "Name (AR)", "Description", "Category", "Unit", "Is Consignment", "Is Active", "Min Stock Level", "Max Stock Level"];
    const csvLines = [header.join(",")];

    for (const item of items) {
      csvLines.push(
        [
          escapeCsvField(item.sku),
          escapeCsvField(item.nameEn),
          escapeCsvField(item.nameAr),
          escapeCsvField(item.description),
          escapeCsvField(item.category?.name),
          escapeCsvField(item.unit?.symbol),
          item.isConsignment ? "Yes" : "No",
          item.isActive ? "Yes" : "No",
          escapeCsvField(item.minStockLevel?.toString()),
          escapeCsvField(item.maxStockLevel?.toString()),
        ].join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="items-${Date.now()}.csv"`);
    res.send(csvLines.join("\n"));
  } catch (error) {
    console.error("CSV export items error:", error);
    res.status(500).json({ error: "Failed to export items" });
  }
});

// ── EXPORT PRICES ─────────────────────────────────────────────
csvRouter.get("/csv/prices/export", async (req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (!requireRole(user, ["ADMIN", "MANAGER", "PROCUREMENT"])) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const branchId = req.query.branchId as string;
    if (!branchId) return res.status(400).json({ error: "branchId is required" });

    const policies = await prisma.pricePolicy.findMany({
      where: { branchId },
      include: { item: true, warehouse: true, shelf: true, branch: true },
      orderBy: { item: { sku: "asc" } },
    });

    const header = [
      "Item SKU", "Item Name (EN)", "Item Name (AR)",
      "Branch", "Warehouse", "Shelf",
      "Wholesale Price (USD)", "Retail Price (USD)",
      "Price Range Min (USD)", "Price Range Max (USD)",
      "Effective From", "Effective To",
    ];
    const csvLines = [header.join(",")];

    for (const p of policies) {
      csvLines.push(
        [
          escapeCsvField(p.item?.sku),
          escapeCsvField(p.item?.nameEn),
          escapeCsvField(p.item?.nameAr),
          escapeCsvField(p.branch?.name),
          escapeCsvField(p.warehouse?.name),
          escapeCsvField(p.shelf?.name),
          escapeCsvField(p.wholesalePriceUsd?.toString()),
          escapeCsvField(p.retailPriceUsd?.toString()),
          escapeCsvField(p.priceRangeMinUsd?.toString()),
          escapeCsvField(p.priceRangeMaxUsd?.toString()),
          escapeCsvField(p.effectiveFrom?.toISOString().split("T")[0]),
          escapeCsvField(p.effectiveTo?.toISOString().split("T")[0]),
        ].join(",")
      );
    }

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="prices-${Date.now()}.csv"`);
    res.send(csvLines.join("\n"));
  } catch (error) {
    console.error("CSV export prices error:", error);
    res.status(500).json({ error: "Failed to export prices" });
  }
});

// ── IMPORT ITEMS ──────────────────────────────────────────────
csvRouter.post("/csv/items/import", csvUpload.single("file"), async (req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (!requireRole(user, ["ADMIN", "PROCUREMENT"])) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!req.file) return res.status(400).json({ error: "No CSV file uploaded" });

    const content = req.file.buffer.toString("utf-8");
    const { headers, rows } = parseCsv(content);

    const requiredHeaders = ["sku", "name (en)", "name (ar)", "category", "unit"];
    const missing = requiredHeaders.filter((h) => !headers.includes(h));
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required columns: ${missing.join(", ")}` });
    }

    const col = (row: string[], name: string) => {
      const idx = headers.indexOf(name);
      return idx >= 0 ? row[idx] || "" : "";
    };

    // Pre-load category and unit lookup maps
    const categories = await prisma.itemCategory.findMany();
    const categoryMap = new Map<string, string>();
    for (const c of categories) {
      categoryMap.set(c.name.toLowerCase(), c.id);
      if (c.nameAr) categoryMap.set(c.nameAr.toLowerCase(), c.id);
    }

    const units = await prisma.unit.findMany();
    const unitMap = new Map<string, string>();
    for (const u of units) {
      unitMap.set(u.symbol.toLowerCase(), u.id);
      unitMap.set(u.name.toLowerCase(), u.id);
      if (u.nameAr) unitMap.set(u.nameAr.toLowerCase(), u.id);
    }

    const results = { created: 0, updated: 0, errors: [] as string[] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const lineNum = i + 2; // 1-indexed + header
      try {
        const sku = col(row, "sku");
        const nameEn = col(row, "name (en)");
        const nameAr = col(row, "name (ar)");
        const description = col(row, "description") || undefined;
        const categoryName = col(row, "category");
        const unitName = col(row, "unit");
        const isConsignment = col(row, "is consignment").toLowerCase() === "yes";
        const isActive = col(row, "is active") ? col(row, "is active").toLowerCase() !== "no" : true;
        const minStock = col(row, "min stock level") ? parseFloat(col(row, "min stock level")) : undefined;
        const maxStock = col(row, "max stock level") ? parseFloat(col(row, "max stock level")) : undefined;

        if (!sku || !nameEn || !nameAr) {
          results.errors.push(`Row ${lineNum}: SKU, Name (EN), and Name (AR) are required`);
          continue;
        }

        const categoryId = categoryMap.get(categoryName.toLowerCase());
        if (!categoryId) {
          results.errors.push(`Row ${lineNum}: Unknown category "${categoryName}"`);
          continue;
        }

        const unitId = unitMap.get(unitName.toLowerCase());
        if (!unitId) {
          results.errors.push(`Row ${lineNum}: Unknown unit "${unitName}"`);
          continue;
        }

        const existing = await prisma.item.findUnique({ where: { sku } });
        if (existing) {
          await prisma.item.update({
            where: { sku },
            data: { nameEn, nameAr, description, categoryId, unitId, isConsignment, isActive, minStockLevel: minStock, maxStockLevel: maxStock },
          });
          results.updated++;
        } else {
          await prisma.item.create({
            data: { sku, nameEn, nameAr, description, categoryId, unitId, isConsignment, isActive: isActive, minStockLevel: minStock, maxStockLevel: maxStock },
          });
          results.created++;
        }
      } catch (err: any) {
        results.errors.push(`Row ${lineNum}: ${err.message}`);
      }
    }

    res.json(results);
  } catch (error: any) {
    console.error("CSV import items error:", error);
    res.status(500).json({ error: error.message || "Failed to import items" });
  }
});

// ── IMPORT PRICES ─────────────────────────────────────────────
csvRouter.post("/csv/prices/import", csvUpload.single("file"), async (req: Request, res: Response) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) return res.status(401).json({ error: "Unauthorized" });
    if (!requireRole(user, ["ADMIN", "PROCUREMENT"])) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (!req.file) return res.status(400).json({ error: "No CSV file uploaded" });

    const branchId = req.body.branchId || (req.query.branchId as string);
    if (!branchId) return res.status(400).json({ error: "branchId is required" });

    const content = req.file.buffer.toString("utf-8");
    const { headers, rows } = parseCsv(content);

    const requiredHeaders = ["item sku", "wholesale price (usd)", "retail price (usd)", "price range min (usd)", "price range max (usd)", "effective from"];
    const missing = requiredHeaders.filter((h) => !headers.includes(h));
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required columns: ${missing.join(", ")}` });
    }

    const col = (row: string[], name: string) => {
      const idx = headers.indexOf(name);
      return idx >= 0 ? row[idx] || "" : "";
    };

    // Pre-load lookup maps
    const items = await prisma.item.findMany({ select: { id: true, sku: true } });
    const itemMap = new Map<string, string>();
    for (const item of items) itemMap.set(item.sku.toLowerCase(), item.id);

    const warehouses = await prisma.warehouse.findMany({ select: { id: true, name: true } });
    const warehouseMap = new Map<string, string>();
    for (const w of warehouses) warehouseMap.set(w.name.toLowerCase(), w.id);

    const shelves = await prisma.shelf.findMany({ select: { id: true, name: true } });
    const shelfMap = new Map<string, string>();
    for (const s of shelves) shelfMap.set(s.name.toLowerCase(), s.id);

    const results = { created: 0, updated: 0, errors: [] as string[] };

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const lineNum = i + 2;
      try {
        const itemSku = col(row, "item sku");
        const wholesalePrice = parseFloat(col(row, "wholesale price (usd)"));
        const retailPrice = parseFloat(col(row, "retail price (usd)"));
        const rangeMin = parseFloat(col(row, "price range min (usd)"));
        const rangeMax = parseFloat(col(row, "price range max (usd)"));
        const effectiveFrom = col(row, "effective from");
        const effectiveTo = col(row, "effective to") || null;
        const warehouseName = col(row, "warehouse") || "";
        const shelfName = col(row, "shelf") || "";

        if (!itemSku) {
          results.errors.push(`Row ${lineNum}: Item SKU is required`);
          continue;
        }

        const itemId = itemMap.get(itemSku.toLowerCase());
        if (!itemId) {
          results.errors.push(`Row ${lineNum}: Unknown item SKU "${itemSku}"`);
          continue;
        }

        if (isNaN(wholesalePrice) || isNaN(retailPrice) || isNaN(rangeMin) || isNaN(rangeMax)) {
          results.errors.push(`Row ${lineNum}: Invalid price values`);
          continue;
        }

        if (!effectiveFrom) {
          results.errors.push(`Row ${lineNum}: Effective From date is required`);
          continue;
        }

        const warehouseId = warehouseName ? warehouseMap.get(warehouseName.toLowerCase()) || null : null;
        const shelfId = shelfName ? shelfMap.get(shelfName.toLowerCase()) || null : null;

        if (warehouseName && !warehouseId) {
          results.errors.push(`Row ${lineNum}: Unknown warehouse "${warehouseName}"`);
          continue;
        }
        if (shelfName && !shelfId) {
          results.errors.push(`Row ${lineNum}: Unknown shelf "${shelfName}"`);
          continue;
        }

        // Check for existing policy with same item + branch + location + date
        const existing = await prisma.pricePolicy.findFirst({
          where: {
            itemId,
            branchId,
            warehouseId: warehouseId || null,
            shelfId: shelfId || null,
            effectiveFrom: new Date(effectiveFrom),
          },
        });

        const data = {
          itemId,
          branchId,
          warehouseId: warehouseId || null,
          shelfId: shelfId || null,
          wholesalePriceUsd: wholesalePrice,
          retailPriceUsd: retailPrice,
          priceRangeMinUsd: rangeMin,
          priceRangeMaxUsd: rangeMax,
          effectiveFrom: new Date(effectiveFrom),
          effectiveTo: effectiveTo ? new Date(effectiveTo) : null,
        };

        if (existing) {
          await prisma.pricePolicy.update({ where: { id: existing.id }, data });
          results.updated++;
        } else {
          await prisma.pricePolicy.create({ data });
          results.created++;
        }
      } catch (err: any) {
        results.errors.push(`Row ${lineNum}: ${err.message}`);
      }
    }

    res.json(results);
  } catch (error: any) {
    console.error("CSV import prices error:", error);
    res.status(500).json({ error: error.message || "Failed to import prices" });
  }
});

export default csvRouter;
