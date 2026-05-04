import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { GroupType } from "./enums";
import type { User } from "./User";
import type { GroupMember } from "./GroupMember";
import type { Expense } from "./Expense";
import type { Settlement } from "./Settlement";
import type { Category } from "./Category";
import type { Tag } from "./Tag";

@Entity({ name: "groups" })
export class Group {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  name!: string;

  @Column({ type: "varchar", nullable: true })
  description!: string | null;

  @Column({
    type: "enum",
    enum: GroupType,
    default: GroupType.HOUSEHOLD,
  })
  type!: GroupType;

  @Column({ name: "created_by" })
  createdById!: string;

  @ManyToOne("User")
  @JoinColumn({ name: "created_by" })
  createdByUser!: User;

  @OneToMany("GroupMember", (gm: GroupMember) => gm.group)
  members!: GroupMember[];

  @OneToMany("Expense", (e: Expense) => e.group)
  expenses!: Expense[];

  @OneToMany("Settlement", (s: Settlement) => s.group)
  settlements!: Settlement[];

  @OneToMany("Category", (c: Category) => c.group)
  categories!: Category[];

  @OneToMany("Tag", (t: Tag) => t.group)
  tags!: Tag[];

  @CreateDateColumn({ name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at" })
  updatedAt!: Date;
}
