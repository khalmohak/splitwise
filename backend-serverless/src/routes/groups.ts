// Top-level mount point for /api/groups/*. The actual router (with all the
// nested sub-routers) lives in src/routes/groups/index.ts.

export { groupsRouter as groups } from "./groups/index.js";
