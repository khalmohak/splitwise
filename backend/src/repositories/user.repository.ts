import { AppDataSource } from "../data-source";
import { User } from "../entity/User";

const repository = () => AppDataSource.getRepository(User);

export type BasicUserRow = {
  id: string;
  name: string;
  email: string;
  avatar_url: string | null;
};

export type CreateUserInput = {
  name: string;
  email: string;
  passwordHash: string;
  avatarUrl: string | null;
};

export const findUserById = async (id: string): Promise<User | null> =>
  repository().findOne({ where: { id } });

export const findUserByEmail = async (email: string): Promise<User | null> =>
  repository().findOne({ where: { email } });

export const createUser = async (input: CreateUserInput): Promise<User> =>
  repository().save(repository().create(input));

export const saveUser = async (user: User): Promise<User> => repository().save(user);

export const listAllUsersBasic = async (): Promise<BasicUserRow[]> =>
  AppDataSource.query(
    `
      SELECT id, name, email, avatar_url
      FROM users
      ORDER BY name ASC
    `,
  );

export const listGroupUsersBasic = async (groupId: string): Promise<BasicUserRow[]> =>
  AppDataSource.query(
    `
      SELECT u.id, u.name, u.email, u.avatar_url
      FROM group_members gm
      INNER JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1
      ORDER BY u.name ASC
    `,
    [groupId],
  );

export const listConnectedUsersBasic = async (userId: string): Promise<BasicUserRow[]> =>
  AppDataSource.query(
    `
      SELECT DISTINCT other_user.id, other_user.name, other_user.email, other_user.avatar_url
      FROM group_members current_member
      INNER JOIN group_members other_member
        ON other_member.group_id = current_member.group_id
        AND other_member.user_id <> $1
      INNER JOIN users other_user ON other_user.id = other_member.user_id
      WHERE current_member.user_id = $1
      ORDER BY other_user.name ASC
    `,
    [userId],
  );
