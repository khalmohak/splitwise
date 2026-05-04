import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  JoinTable,
  ManyToMany,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { RecurInterval, SplitType } from "./enums";
import type { Group } from "./Group";
import type { User } from "./User";
import type { Category } from "./Category";
import type { Tag } from "./Tag";
import type { ExpenseParticipant } from "./ExpenseParticipant";

@Entity({ name: "expenses" })
export class Expense {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "group_id" })
  groupId!: string;

  @ManyToOne("Group", (g: Group) => g.expenses)
  @JoinColumn({ name: "group_id" })
  group!: Group;

  @Column({ name: "paid_by" })
  paidById!: string;

  @ManyToOne("User", (u: User) => u.expensesPaid)
  @JoinColumn({ name: "paid_by" })
  paidByUser!: User;

  @Column({ type: "decimal", precision: 12, scale: 2 })
  amount!: string;

  @Column()
  description!: string;

  @Column({ name: "category_id", type: "uuid", nullable: true })
  categoryId!: string | null;

  @ManyToOne("Category", (c: Category) => c.expenses, { nullable: true })
  @JoinColumn({ name: "category_id" })
  category!: Category | null;

  @Column({ type: "enum", enum: SplitType, name: "split_type" })
  splitType!: SplitType;

  @Column({ type: "date" })
  date!: string;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @Column({ name: "is_recurring", default: false })
  isRecurring!: boolean;

  @Column({
    name: "recur_interval",
    type: "enum",
    enum: RecurInterval,
    nullable: true,
  })
  recurInterval!: RecurInterval | null;

  // Next due date for recurring expenses
  @Column({ name: "recur_anchor", type: "date", nullable: true })
  recurAnchor!: string | null;

  @Column({ name: "created_by" })
  createdById!: string;

  @ManyToOne("User")
  @JoinColumn({ name: "created_by" })
  createdByUser!: User;

  @OneToMany("ExpenseParticipant", (ep: ExpenseParticipant) => ep.expense, {
    cascade: true,
  })
  participants!: ExpenseParticipant[];

  @ManyToMany("Tag", (t: Tag) => t.expenses)
  @JoinTable({
    name: "expense_tags",
    joinColumn: { name: "expense_id", referencedColumnName: "id" },
    inverseJoinColumn: { name: "tag_id", referencedColumnName: "id" },
  })
  tags!: Tag[];

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
