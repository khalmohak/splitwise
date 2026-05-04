import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import type { Expense } from "./Expense";
import type { User } from "./User";

@Entity({ name: "expense_participants" })
export class ExpenseParticipant {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "expense_id" })
  expenseId!: string;

  @ManyToOne("Expense", (e: Expense) => e.participants, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "expense_id" })
  expense!: Expense;

  @Column({ name: "user_id" })
  userId!: string;

  @ManyToOne("User", (u: User) => u.expenseParticipations)
  @JoinColumn({ name: "user_id" })
  user!: User;

  // Final computed amount this person owes for the expense
  @Column({ name: "share_amount", type: "decimal", precision: 12, scale: 2 })
  shareAmount!: string;

  // Raw split input: % value, share count, or exact amount depending on splitType
  @Column({
    name: "split_input",
    type: "decimal",
    precision: 12,
    scale: 4,
    nullable: true,
  })
  splitInput!: string | null;
}
