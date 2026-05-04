import { Router } from "express";

import {
  exportUserAnalyticsHandler,
  exportUserBalancesHandler,
} from "../controllers/exports.controller";
import {
  getMe,
  getMyAnalytics,
  getMyAnalyticsTrends,
  getMyBalances,
  getMySettlementSuggestions,
  listUsers,
  updateMe,
} from "../controllers/users.controller";
import { userActivityHandler } from "../controllers/activity.controller";
import { userDashboardHandler } from "../controllers/dashboard.controller";
import {
  getPersonDetailHandler,
  listPeopleHandler,
  settleWithPersonHandler,
} from "../controllers/people.controller";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/async-handler";

const router = Router();

router.use(requireAuth);

router.get("/", asyncHandler(listUsers));
router.get("/me/activity", asyncHandler(userActivityHandler));
router.get("/me/dashboard", asyncHandler(userDashboardHandler));
router.get("/me/balances/export.csv", asyncHandler(exportUserBalancesHandler));
router.get("/me/balances", asyncHandler(getMyBalances));
router.get("/me/settlements/suggestions", asyncHandler(getMySettlementSuggestions));
router.get("/me/analytics/export.csv", asyncHandler(exportUserAnalyticsHandler));
router.get("/me/analytics/trends", asyncHandler(getMyAnalyticsTrends));
router.get("/me/analytics", asyncHandler(getMyAnalytics));
router.get("/me/people", asyncHandler(listPeopleHandler));
router.post("/me/people/:userId/settle", asyncHandler(settleWithPersonHandler));
router.get("/me/people/:userId", asyncHandler(getPersonDetailHandler));
router.get("/me", asyncHandler(getMe));
router.put("/me", asyncHandler(updateMe));

export default router;
