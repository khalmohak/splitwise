-- System-wide categories and tags. group_id IS NULL marks a row as system-wide.
-- Idempotent: re-running upserts by (name) within the system scope.
--
-- Run with: psql "$DATABASE_URL" -f src/db/seeds/system_taxonomy.sql

BEGIN;

-- tags.group_id is NOT NULL in the base schema; relax it so system tags can exist.
ALTER TABLE "tags" ALTER COLUMN "group_id" DROP NOT NULL;

-- Partial unique indexes so ON CONFLICT can target system rows specifically
-- without colliding with per-group names.
CREATE UNIQUE INDEX IF NOT EXISTS "categories_system_name_unique"
  ON "categories" ("name") WHERE "group_id" IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "tags_system_name_unique"
  ON "tags" ("name") WHERE "group_id" IS NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- Categories (17 + fallback)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO "categories" ("group_id", "name", "icon", "color") VALUES
  -- Tier 1 — weekly
  (NULL, 'Groceries',              'ShoppingBasket', NULL),
  (NULL, 'Eating Out',             'Utensils',       NULL),
  (NULL, 'Order In',               'Bike',           NULL),
  (NULL, 'Transport',              'Car',            NULL),
  (NULL, 'Drinks & Bar',           'Beer',           NULL),
  -- Tier 2 — monthly recurring
  (NULL, 'Rent',                   'KeyRound',       NULL),
  (NULL, 'Maid & Help',            'Brush',          NULL),
  (NULL, 'Utilities',              'Zap',            NULL),
  (NULL, 'Internet & Subs',        'Wifi',           NULL),
  (NULL, 'Household',              'SprayCan',       NULL),
  -- Tier 3 — occasional
  (NULL, 'Repairs',                'Wrench',         NULL),
  (NULL, 'Appliances & Furniture', 'Sofa',           NULL),
  (NULL, 'Travel',                 'Plane',          NULL),
  (NULL, 'Entertainment',          'Ticket',         NULL),
  (NULL, 'Health & Pharmacy',      'Pill',           NULL),
  (NULL, 'Gifts & Occasions',      'Gift',           NULL),
  -- Fallback
  (NULL, 'Other',                  'MoreHorizontal', NULL)
ON CONFLICT ("name") WHERE "group_id" IS NULL
DO UPDATE SET "icon" = EXCLUDED."icon", "color" = EXCLUDED."color";

-- ────────────────────────────────────────────────────────────────────────────
-- Tags (24)
-- ────────────────────────────────────────────────────────────────────────────
INSERT INTO "tags" ("group_id", "name", "color") VALUES
  -- Food delivery
  (NULL, 'swiggy',       '#fc8019'),
  (NULL, 'zomato',       '#e23744'),
  -- Quick commerce
  (NULL, 'blinkit',      '#f8cb46'),
  (NULL, 'zepto',        '#7c3aed'),
  (NULL, 'instamart',    '#fc8019'),
  (NULL, 'bigbasket',    '#84cc16'),
  (NULL, 'amazon',       '#ff9900'),
  -- Rides
  (NULL, 'uber',         '#000000'),
  (NULL, 'ola',          '#c4f000'),
  (NULL, 'rapido',       '#fcd34d'),
  -- Subscriptions
  (NULL, 'netflix',      '#e50914'),
  (NULL, 'prime',        '#00a8e1'),
  (NULL, 'spotify',      '#1db954'),
  (NULL, 'hotstar',      '#1f80e0'),
  -- Recurrence / state
  (NULL, 'monthly',      '#0ea5e9'),
  (NULL, 'recurring',    '#06b6d4'),
  (NULL, 'one-off',      '#94a3b8'),
  (NULL, 'urgent',       '#dc2626'),
  -- Occasion (India)
  (NULL, 'diwali',       '#f59e0b'),
  (NULL, 'holi',         '#ec4899'),
  (NULL, 'birthday',     '#a855f7'),
  (NULL, 'housewarming', '#10b981'),
  -- Vibe
  (NULL, 'fun',          '#ec4899'),
  (NULL, 'treat',        '#f43f5e'),
  (NULL, 'regret',       '#71717a')
ON CONFLICT ("name") WHERE "group_id" IS NULL
DO UPDATE SET "color" = EXCLUDED."color";

COMMIT;
