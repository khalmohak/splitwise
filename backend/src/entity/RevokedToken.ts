import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity({ name: "revoked_tokens" })
export class RevokedToken {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "token_hash", unique: true })
  tokenHash!: string;

  @Column({ name: "expires_at" })
  expiresAt!: Date;

  @CreateDateColumn({ name: "revoked_at" })
  revokedAt!: Date;
}
