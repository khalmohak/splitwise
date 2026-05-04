import {
  Column,
  Entity,
  JoinColumn,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
} from "typeorm";
import type { Group } from "./Group";
import type { Expense } from "./Expense";

@Entity({ name: "tags" })
export class Tag {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "group_id" })
  groupId!: string;

  @ManyToOne("Group", (g: Group) => g.tags)
  @JoinColumn({ name: "group_id" })
  group!: Group;

  @Column()
  name!: string;

  @Column({ type: "varchar", nullable: true })
  color!: string | null;

  @ManyToMany("Expense", (e: Expense) => e.tags)
  expenses!: Expense[];
}
