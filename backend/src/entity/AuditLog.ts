import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import type { Group } from "./Group";
import type { User } from "./User";

export enum AuditAction {
  CREATED = "created",
  UPDATED = "updated",
  DELETED = "deleted",
}

export enum AuditResourceType {
  EXPENSE = "expense",
  SETTLEMENT = "settlement",
}

export type AuditChange = {
  field: string;
  before: unknown;
  after: unknown;
};

@Entity({ name: "audit_logs" })
export class AuditLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "group_id" })
  groupId!: string;

  @ManyToOne("Group", { onDelete: "CASCADE" })
  @JoinColumn({ name: "group_id" })
  group!: Group;

  @Column({ name: "actor_id" })
  actorId!: string;

  @ManyToOne("User")
  @JoinColumn({ name: "actor_id" })
  actor!: User;

  @Column({ type: "varchar" })
  action!: AuditAction;

  @Column({ name: "resource_type", type: "varchar" })
  resourceType!: AuditResourceType;

  @Column({ name: "resource_id", type: "uuid" })
  resourceId!: string;

  @Column({ type: "varchar" })
  summary!: string;

  @Column({ type: "jsonb", nullable: true })
  before!: Record<string, unknown> | null;

  @Column({ type: "jsonb", nullable: true })
  after!: Record<string, unknown> | null;

  @Column({ name: "changed_fields", type: "jsonb", nullable: true })
  changedFields!: AuditChange[] | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
