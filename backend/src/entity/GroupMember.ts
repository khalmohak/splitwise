import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from "typeorm";
import { MemberRole } from "./enums";
import type { Group } from "./Group";
import type { User } from "./User";

@Entity({ name: "group_members" })
export class GroupMember {
  @PrimaryColumn({ name: "group_id" })
  groupId!: string;

  @PrimaryColumn({ name: "user_id" })
  userId!: string;

  @ManyToOne("Group", (g: Group) => g.members)
  @JoinColumn({ name: "group_id" })
  group!: Group;

  @ManyToOne("User", (u: User) => u.groupMemberships)
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ type: "enum", enum: MemberRole, default: MemberRole.MEMBER })
  role!: MemberRole;

  @CreateDateColumn({ name: "joined_at" })
  joinedAt!: Date;
}
