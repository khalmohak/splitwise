import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from "typeorm";
import type { Group } from "./Group";
import type { Expense } from "./Expense";

@Entity({ name: "categories" })
export class Category {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  // null = system-wide default category
  @Column({ name: "group_id", type: "uuid", nullable: true })
  groupId!: string | null;

  @ManyToOne("Group", (g: Group) => g.categories, { nullable: true })
  @JoinColumn({ name: "group_id" })
  group!: Group | null;

  @Column()
  name!: string;

  @Column({ type: "varchar", nullable: true })
  icon!: string | null;

  @Column({ type: "varchar", nullable: true })
  color!: string | null;

  @OneToMany("Expense", (e: Expense) => e.category)
  expenses!: Expense[];
}
