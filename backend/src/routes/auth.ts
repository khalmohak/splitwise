import { Router } from "express";

import {
  login,
  logout,
  register,
  updatePassword,
} from "../controllers/auth.controller";
import { requireAuth } from "../middleware/auth";
import { asyncHandler } from "../utils/async-handler";

const router = Router();

router.post("/register", asyncHandler(register));
router.post("/login", asyncHandler(login));
router.post("/logout", requireAuth, asyncHandler(logout));
router.put("/password", requireAuth, asyncHandler(updatePassword));

export default router;
