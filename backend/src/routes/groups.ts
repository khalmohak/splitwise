import { Router } from "express";

import {
  addMemberHandler,
  createGroup,
  deleteGroupHandler,
  getGroup,
  listGroups,
  removeMemberHandler,
  updateGroupHandler,
  updateMemberRoleHandler,
} from "../controllers/groups.controller";
import {
  createGroupCategoryHandler,
  deleteGroupCategoryHandler,
  listGroupCategoriesHandler,
  updateGroupCategoryHandler,
} from "../controllers/categories.controller";
import {
  createGroupTagHandler,
  deleteGroupTagHandler,
  listGroupTagsHandler,
  updateGroupTagHandler,
} from "../controllers/tags.controller";
import {
  createExpenseHandler,
  deleteExpenseHandler,
  getExpenseHandler,
  listExpensesHandler,
  listRecurringExpensesHandler,
  previewExpenseHandler,
  updateExpenseHandler,
} from "../controllers/expenses.controller";
import {
  getGroupBalancesHandler,
  getMyGroupBalancesHandler,
  getSimplifiedGroupBalancesHandler,
} from "../controllers/balances.controller";
import {
  createSettlementHandler,
  deleteSettlementHandler,
  groupSettlementSuggestionsHandler,
  listSettlementsHandler,
  recordSuggestedSettlementHandler,
  settleWithUserHandler,
} from "../controllers/settlements.controller";
import {
  groupAnalyticsAnomaliesHandler,
  groupAnalyticsCategoriesHandler,
  groupAnalyticsCategoryTrendsHandler,
  groupAnalyticsComparisonHandler,
  groupAnalyticsMembersHandler,
  groupAnalyticsMemberTrendsHandler,
  groupAnalyticsPatternsHandler,
  groupAnalyticsSummaryHandler,
  groupAnalyticsTagsHandler,
  groupAnalyticsTrendsHandler,
} from "../controllers/analytics.controller";
import { groupActivityHandler } from "../controllers/activity.controller";
import { groupDashboardHandler } from "../controllers/dashboard.controller";
import {
  exportGroupAnalyticsHandler,
  exportGroupExpensesHandler,
  exportGroupSettlementsHandler,
} from "../controllers/exports.controller";
import {
  deleteGroupBudgetHandler,
  listGroupBudgetsHandler,
  upsertGroupBudgetHandler,
} from "../controllers/budgets.controller";
import { groupAuditHandler } from "../controllers/audit.controller";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/async-handler";

const router = Router();

router.use(requireAuth);

router.post("/", asyncHandler(createGroup));
router.get("/", asyncHandler(listGroups));
router.get("/:groupId", asyncHandler(getGroup));
router.put("/:groupId", asyncHandler(updateGroupHandler));
router.delete("/:groupId", asyncHandler(deleteGroupHandler));

router.post("/:groupId/members", asyncHandler(addMemberHandler));
router.patch("/:groupId/members/:userId", asyncHandler(updateMemberRoleHandler));
router.delete("/:groupId/members/:userId", asyncHandler(removeMemberHandler));

router.get("/:groupId/categories", asyncHandler(listGroupCategoriesHandler));
router.post("/:groupId/categories", asyncHandler(createGroupCategoryHandler));
router.put("/:groupId/categories/:categoryId", asyncHandler(updateGroupCategoryHandler));
router.delete("/:groupId/categories/:categoryId", asyncHandler(deleteGroupCategoryHandler));

router.get("/:groupId/tags", asyncHandler(listGroupTagsHandler));
router.post("/:groupId/tags", asyncHandler(createGroupTagHandler));
router.put("/:groupId/tags/:tagId", asyncHandler(updateGroupTagHandler));
router.delete("/:groupId/tags/:tagId", asyncHandler(deleteGroupTagHandler));

router.post("/:groupId/expenses/preview", asyncHandler(previewExpenseHandler));
router.get("/:groupId/expenses/recurring", asyncHandler(listRecurringExpensesHandler));
router.get("/:groupId/expenses/export.csv", asyncHandler(exportGroupExpensesHandler));
router.post("/:groupId/expenses", asyncHandler(createExpenseHandler));
router.get("/:groupId/expenses", asyncHandler(listExpensesHandler));
router.get("/:groupId/expenses/:expenseId", asyncHandler(getExpenseHandler));
router.put("/:groupId/expenses/:expenseId", asyncHandler(updateExpenseHandler));
router.delete("/:groupId/expenses/:expenseId", asyncHandler(deleteExpenseHandler));

router.get("/:groupId/balances/simplified", asyncHandler(getSimplifiedGroupBalancesHandler));
router.get("/:groupId/balances/me", asyncHandler(getMyGroupBalancesHandler));
router.get("/:groupId/balances", asyncHandler(getGroupBalancesHandler));

router.get("/:groupId/settlements/suggestions", asyncHandler(groupSettlementSuggestionsHandler));
router.post("/:groupId/settlements/suggestions/record", asyncHandler(recordSuggestedSettlementHandler));
router.post("/:groupId/settlements/settle-with/:userId", asyncHandler(settleWithUserHandler));
router.post("/:groupId/settlements", asyncHandler(createSettlementHandler));
router.get("/:groupId/settlements/export.csv", asyncHandler(exportGroupSettlementsHandler));
router.get("/:groupId/settlements", asyncHandler(listSettlementsHandler));
router.delete("/:groupId/settlements/:settlementId", asyncHandler(deleteSettlementHandler));

router.get("/:groupId/budgets", asyncHandler(listGroupBudgetsHandler));
router.put("/:groupId/budgets", asyncHandler(upsertGroupBudgetHandler));
router.delete("/:groupId/budgets/:budgetId", asyncHandler(deleteGroupBudgetHandler));

router.get("/:groupId/analytics/export.csv", asyncHandler(exportGroupAnalyticsHandler));
router.get("/:groupId/analytics/summary", asyncHandler(groupAnalyticsSummaryHandler));
router.get("/:groupId/analytics/comparison", asyncHandler(groupAnalyticsComparisonHandler));
router.get("/:groupId/analytics/trends", asyncHandler(groupAnalyticsTrendsHandler));
router.get("/:groupId/analytics/categories", asyncHandler(groupAnalyticsCategoriesHandler));
router.get("/:groupId/analytics/categories/trends", asyncHandler(groupAnalyticsCategoryTrendsHandler));
router.get("/:groupId/analytics/members", asyncHandler(groupAnalyticsMembersHandler));
router.get("/:groupId/analytics/members/trends", asyncHandler(groupAnalyticsMemberTrendsHandler));
router.get("/:groupId/analytics/tags", asyncHandler(groupAnalyticsTagsHandler));
router.get("/:groupId/analytics/patterns", asyncHandler(groupAnalyticsPatternsHandler));
router.get("/:groupId/analytics/anomalies", asyncHandler(groupAnalyticsAnomaliesHandler));

router.get("/:groupId/audit", asyncHandler(groupAuditHandler));
router.get("/:groupId/activity", asyncHandler(groupActivityHandler));
router.get("/:groupId/dashboard", asyncHandler(groupDashboardHandler));

export default router;
