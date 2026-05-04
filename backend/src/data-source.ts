import "reflect-metadata";
import path from "node:path";
import { DataSource } from "typeorm";

import { env } from "./config/env";
import { User } from "./entity/User";
import { Group } from "./entity/Group";
import { GroupMember } from "./entity/GroupMember";
import { Category } from "./entity/Category";
import { Tag } from "./entity/Tag";
import { Expense } from "./entity/Expense";
import { ExpenseParticipant } from "./entity/ExpenseParticipant";
import { Settlement } from "./entity/Settlement";
import { RevokedToken } from "./entity/RevokedToken";
import { AuditLog } from "./entity/AuditLog";
import { Budget } from "./entity/Budget";

export const AppDataSource = new DataSource({
  type: "postgres",
  host: env.dbHost,
  port: env.dbPort,
  username: env.dbUsername,
  password: env.dbPassword,
  database: env.dbName,
  synchronize: env.nodeEnv !== "production",
  logging: false,
  entities: [
    User,
    Group,
    GroupMember,
    Category,
    Tag,
    Expense,
    ExpenseParticipant,
    Settlement,
    RevokedToken,
    AuditLog,
    Budget,
  ],
  migrations: [path.join(__dirname, "migrations/*.{ts,js}")],
});
