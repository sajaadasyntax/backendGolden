import "dotenv/config";
import express from "express";
import cors from "cors";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { appRouter } from "./routers/index.js";
import { createContext } from "./trpc/context.js";
import { prisma } from "./lib/prisma.js";
import { autoClosePreviousDayCycles } from "./lib/dayCycle.js";

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
// Allow multiple origins for web and mobile
const isProduction = process.env.NODE_ENV === 'production';
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  process.env.API_URL || "https://api.alzahaby.cloud",
  "https://api.alzahaby.cloud",
  "http://localhost:3000",
  "http://localhost:8081", // Expo web
  "exp://localhost:8081", // Expo Go
  /^exp:\/\/.*/, // All Expo Go URLs
  /^http:\/\/.*:8081$/, // Expo web dev server
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);
    
    // In production, enforce CORS strictly
    if (isProduction) {
      const isAllowed = allowedOrigins.some(allowed => {
        if (typeof allowed === 'string') {
          return origin === allowed;
        }
        if (allowed instanceof RegExp) {
          return allowed.test(origin);
        }
        return false;
      });
      
      if (isAllowed) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    } else {
      // In development, allow all origins
      callback(null, true);
    }
  },
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// tRPC
app.use(
  "/trpc",
  createExpressMiddleware({
    router: appRouter,
    createContext,
    onError: ({ path, error }) => {
      console.error(`tRPC error on ${path}:`, error);
    },
  })
);

// Database connection test function
async function testDatabaseConnection() {
  console.log("\n🔍 Testing database connection...");
  
  try {
    const startTime = Date.now();
    
    // Test connection with a simple query
    await prisma.$queryRaw`SELECT 1`;
    
    const connectionTime = Date.now() - startTime;
    
    // Get database info
    const dbInfo = await prisma.$queryRaw<Array<{ current_database: string; version: string }>>`
      SELECT current_database(), version()
    `;
    
    const databaseName = dbInfo[0]?.current_database || "unknown";
    const dbVersion = dbInfo[0]?.version?.split(" ")[0] || "unknown";
    
    // Extract database URL info (without password)
    const dbUrl = process.env.DATABASE_URL || "";
    // Handle different URL formats (including Neon, Supabase, etc.)
    let dbHost = "unknown";
    let dbPort = "unknown";
    
    // Try standard PostgreSQL URL format
    const standardMatch = dbUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
    if (standardMatch) {
      dbHost = standardMatch[3];
      dbPort = standardMatch[4];
    } else {
      // Try Neon/Supabase format: postgresql://user:pass@host/db?sslmode=require
      const neonMatch = dbUrl.match(/postgresql:\/\/([^:]+):([^@]+)@([^\/]+)\/([^\?]+)/);
      if (neonMatch) {
        const hostPart = neonMatch[3];
        const portMatch = hostPart.match(/:(\d+)$/);
        dbHost = portMatch ? hostPart.replace(/:\d+$/, "") : hostPart;
        dbPort = portMatch ? portMatch[1] : "5432";
      }
    }
    
    // Check if using Neon or serverless database (connection pooling recommended)
    const isNeon = dbUrl.includes("neon.tech") || dbUrl.includes("neon.tech");
    const hasPooler = dbUrl.includes("pooler") || dbUrl.includes("pgbouncer") || dbUrl.includes("pgbouncer=true");
    
    console.log("✅ Database connection successful!");
    console.log(`   📊 Database: ${databaseName}`);
    console.log(`   🖥️  Host: ${dbHost}:${dbPort}`);
    console.log(`   📦 PostgreSQL Version: ${dbVersion}`);
    console.log(`   ⚡ Connection time: ${connectionTime}ms`);
    
    if (isNeon) {
      if (!hasPooler) {
        console.log(`   ⚠️  WARNING: Using Neon without connection pooler!`);
        console.log(`      This can cause "connection pool exhausted" errors.`);
        console.log(`      Solution: Use Neon's pooler endpoint or add ?pgbouncer=true`);
        console.log(`      Example: postgresql://user:pass@host.neon.tech/db?pgbouncer=true`);
      } else {
        console.log(`   ✅ Using connection pooler (recommended for Neon)`);
      }
    }
    
    console.log("");
    
    return true;
  } catch (error: any) {
    console.error("❌ Database connection failed!");
    console.error(`   Error: ${error.message || error}`);
    console.error(`   Code: ${error.code || "UNKNOWN"}`);
    
    if (error.code === "ECONNREFUSED") {
      console.error("   💡 Tip: Make sure PostgreSQL is running and accessible");
    } else if (error.code === "P1001") {
      console.error("   💡 Tip: Check your DATABASE_URL environment variable");
    } else if (error.code === "P1000") {
      console.error("   💡 Tip: Check database credentials and permissions");
    } else if (error.code === "P2024") {
      console.error("   💡 Tip: Connection pool exhausted. Try:");
      console.error("      - Using a connection pooler (pgbouncer) for serverless databases");
      console.error("      - Adding ?pgbouncer=true to DATABASE_URL (for Neon)");
      console.error("      - Increasing DATABASE_POOL_SIZE in .env");
      console.error("      - Checking for connection leaks (unclosed queries)");
    }
    
    console.error("");
    return false;
  }
}

// Start server with database connection test
async function startServer() {
  // Test database connection first
  const dbConnected = await testDatabaseConnection();
  
  if (!dbConnected) {
    console.warn("⚠️  Warning: Database connection failed, but server will continue to start.");
    console.warn("   Some features may not work until the database is available.\n");
  } else {
    // Auto-close any previous day cycles on server startup
    try {
      const closedCount = await autoClosePreviousDayCycles();
      if (closedCount > 0) {
        console.log(`✅ Auto-closed ${closedCount} previous day cycle(s) on startup`);
      }
    } catch (error) {
      console.warn("⚠️  Warning: Failed to auto-close previous day cycles:", error);
    }
  }
  
  const server = app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📡 tRPC endpoint: http://localhost:${PORT}/trpc`);
    console.log(`💚 Health check: http://localhost:${PORT}/health\n`);
  });
  
  // Graceful shutdown handlers
  const gracefulShutdown = async (signal: string) => {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    
    server.close(async () => {
      console.log("🔌 HTTP server closed.");
      
      try {
        await prisma.$disconnect();
        console.log("🔌 Database connection closed.");
        console.log("👋 Goodbye!");
        process.exit(0);
      } catch (error) {
        console.error("❌ Error during database disconnection:", error);
        process.exit(1);
      }
    });
    
    // Force shutdown after 10 seconds
    setTimeout(() => {
      console.error("⚠️  Forcing shutdown after timeout");
      process.exit(1);
    }, 10000);
  };
  
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  
  return server;
}

// Start the server
startServer().catch((error) => {
  console.error("❌ Failed to start server:", error);
  process.exit(1);
});

export type { AppRouter } from "./routers/index.js";

