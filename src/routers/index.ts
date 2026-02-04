import { router } from "../trpc/trpc.js";
import { authRouter } from "./auth.js";
import { branchRouter } from "./branch.js";
import { userRouter } from "./user.js";
import { dayCycleRouter } from "./dayCycle.js";
import { inventoryRouter } from "./inventory.js";
import { procurementRouter } from "./procurement.js";
import { salesRouter } from "./sales.js";
import { accountingRouter } from "./accounting.js";

export const appRouter = router({
  auth: authRouter,
  branch: branchRouter,
  user: userRouter,
  dayCycle: dayCycleRouter,
  inventory: inventoryRouter,
  procurement: procurementRouter,
  sales: salesRouter,
  accounting: accountingRouter,
});

export type AppRouter = typeof appRouter;

