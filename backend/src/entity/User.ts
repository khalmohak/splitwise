import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import type { GroupMember } from "./GroupMember";
import type { Expense } from "./Expense";
import type { ExpenseParticipant } from "./ExpenseParticipant";
import type { Settlement } from "./Settlement";

@Entity({ name: "users" })
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true })
  email!: string;

  @Column()
  name!: string;

  @Column({ name: "password_hash" })
  passwordHash!: string;

  @Column({ name: "avatar_url", type: "varchar", nullable: true })
  avatarUrl!: string | null;

  @OneToMany("GroupMember", (gm: GroupMember) => gm.user)
  groupMemberships!: GroupMember[];

  @OneToMany("Expense", (e: Expense) => e.paidByUser)
  expensesPaid!: Expense[];

  @OneToMany("ExpenseParticipant", (ep: ExpenseParticipant) => ep.user)
  expenseParticipations!: ExpenseParticipant[];

  @OneToMany("Settlement", (s: Settlement) => s.paidByUser)
  settlementsMade!: Settlement[];

  @OneToMany("Settlement", (s: Settlement) => s.paidToUser)
  settlementsReceived!: Settlement[];

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
