import { Router } from "express";

import { listSystemCategoriesHandler } from "../controllers/categories.controller";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/async-handler";

const router = Router();

router.use(requireAuth);
router.get("/", asyncHandler(listSystemCategoriesHandler));

export default router;
