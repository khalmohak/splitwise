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

@Entity({ name: "settlements" })
export class Settlement {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "group_id" })
  groupId!: string;

  @ManyToOne("Group", (g: Group) => g.settlements)
  @JoinColumn({ name: "group_id" })
  group!: Group;

  @Column({ name: "paid_by" })
  paidById!: string;

  // Who transferred the money
  @ManyToOne("User", (u: User) => u.settlementsMade)
  @JoinColumn({ name: "paid_by" })
  paidByUser!: User;

  @Column({ name: "paid_to" })
  paidToId!: string;

  // Who received the money
  @ManyToOne("User", (u: User) => u.settlementsReceived)
  @JoinColumn({ name: "paid_to" })
  paidToUser!: User;

  @Column({ type: "decimal", precision: 12, scale: 2 })
  amount!: string;

  @Column({ type: "date" })
  date!: string;

  @Column({ type: "text", nullable: true })
  notes!: string | null;

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;
}
