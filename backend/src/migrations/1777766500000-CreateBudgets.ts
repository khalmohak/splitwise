import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateBudgets1777766500000 implements MigrationInterface {
  name = "CreateBudgets1777766500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE "budgets" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "group_id" uuid NOT NULL,
        "category_id" uuid,
        "month" varchar(7) NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "created_by" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_budgets_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_budgets_group_category_month" UNIQUE ("group_id", "category_id", "month")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_budgets_group_null_category_month"
      ON "budgets" ("group_id", "month")
      WHERE "category_id" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "budgets"
      ADD CONSTRAINT "FK_budgets_group_id"
      FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "budgets"
      ADD CONSTRAINT "FK_budgets_category_id"
      FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "budgets"
      ADD CONSTRAINT "FK_budgets_created_by"
      FOREIGN KEY ("created_by") REFERENCES "users"("id")
    `);
    await queryRunner.query(`CREATE INDEX "IDX_budgets_group_month" ON "budgets" ("group_id", "month")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_budgets_group_month"`);
    await queryRunner.query(`DROP INDEX "UQ_budgets_group_null_category_month"`);
    await queryRunner.query(`ALTER TABLE "budgets" DROP CONSTRAINT "FK_budgets_created_by"`);
    await queryRunner.query(`ALTER TABLE "budgets" DROP CONSTRAINT "FK_budgets_category_id"`);
    await queryRunner.query(`ALTER TABLE "budgets" DROP CONSTRAINT "FK_budgets_group_id"`);
    await queryRunner.query(`DROP TABLE "budgets"`);
  }
}
