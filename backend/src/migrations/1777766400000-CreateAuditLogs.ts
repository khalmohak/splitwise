import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAuditLogs1777766400000 implements MigrationInterface {
  name = "CreateAuditLogs1777766400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(`
      CREATE TABLE "audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "group_id" uuid NOT NULL,
        "actor_id" uuid NOT NULL,
        "action" varchar NOT NULL,
        "resource_type" varchar NOT NULL,
        "resource_id" uuid NOT NULL,
        "summary" varchar NOT NULL,
        "before" jsonb,
        "after" jsonb,
        "changed_fields" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      ADD CONSTRAINT "FK_audit_logs_group_id"
      FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE "audit_logs"
      ADD CONSTRAINT "FK_audit_logs_actor_id"
      FOREIGN KEY ("actor_id") REFERENCES "users"("id")
    `);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_group_created" ON "audit_logs" ("group_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_audit_logs_resource" ON "audit_logs" ("resource_type", "resource_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_resource"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_logs_group_created"`);
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_audit_logs_actor_id"`);
    await queryRunner.query(`ALTER TABLE "audit_logs" DROP CONSTRAINT "FK_audit_logs_group_id"`);
    await queryRunner.query(`DROP TABLE "audit_logs"`);
  }
}
