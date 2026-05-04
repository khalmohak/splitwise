import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from "typeorm";
import type { Category } from "./Category";
import type { Group } from "./Group";
import type { User } from "./User";

@Entity({ name: "budgets" })
@Unique("UQ_budgets_group_category_month", ["groupId", "categoryId", "month"])
export class Budget {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "group_id" })
  groupId!: string;

  @ManyToOne("Group", { onDelete: "CASCADE" })
  @JoinColumn({ name: "group_id" })
  group!: Group;

  @Column({ name: "category_id", type: "uuid", nullable: true })
  categoryId!: string | null;

  @ManyToOne("Category", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "category_id" })
  category!: Category | null;

  @Column({ type: "varchar", length: 7 })
  month!: string;

  @Column({ type: "decimal", precision: 12, scale: 2 })
  amount!: string;

  @Column({ name: "created_by" })
  createdById!: string;

  @ManyToOne("User")
  @JoinColumn({ name: "created_by" })
  createdByUser!: User;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
