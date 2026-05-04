import { IsNull } from "typeorm";

import { AppDataSource } from "../data-source";
import { Category } from "../entity/Category";

export type SystemCategorySeed = {
  name: string;
  icon: string;
  color: string;
};

export const systemCategories: SystemCategorySeed[] = [
  { name: "Rent", icon: "🏠", color: "#EF4444" },
  { name: "Groceries", icon: "🛒", color: "#10B981" },
  { name: "Utilities", icon: "⚡", color: "#F59E0B" },
  { name: "Internet", icon: "📶", color: "#3B82F6" },
  { name: "Food & Dining", icon: "🍕", color: "#F97316" },
  { name: "Transport", icon: "🚗", color: "#8B5CF6" },
  { name: "Entertainment", icon: "🎬", color: "#EC4899" },
  { name: "Travel", icon: "✈️", color: "#06B6D4" },
  { name: "Household", icon: "🧹", color: "#84CC16" },
  { name: "Subscriptions", icon: "📱", color: "#6366F1" },
  { name: "Misc", icon: "📦", color: "#9CA3AF" },
];

export const seedSystemCategories = async (): Promise<{
  created: number;
  updated: number;
  unchanged: number;
}> => {
  const categoryRepository = AppDataSource.getRepository(Category);
  let created = 0;
  let updated = 0;
  let unchanged = 0;

  for (const seedCategory of systemCategories) {
    const existingCategory = await categoryRepository.findOne({
      where: {
        groupId: IsNull(),
        name: seedCategory.name,
      },
    });

    if (!existingCategory) {
      await categoryRepository.save(
        categoryRepository.create({
          ...seedCategory,
          groupId: null,
        }),
      );
      created += 1;
      continue;
    }

    if (
      existingCategory.icon === seedCategory.icon &&
      existingCategory.color === seedCategory.color
    ) {
      unchanged += 1;
      continue;
    }

    existingCategory.icon = seedCategory.icon;
    existingCategory.color = seedCategory.color;
    await categoryRepository.save(existingCategory);
    updated += 1;
  }

  return { created, updated, unchanged };
};

const run = async (): Promise<void> => {
  await AppDataSource.initialize();

  try {
    const result = await seedSystemCategories();
    console.log(
      `Seeded system categories. Created: ${result.created}, updated: ${result.updated}, unchanged: ${result.unchanged}.`,
    );
  } finally {
    await AppDataSource.destroy();
  }
};

if (require.main === module) {
  run().catch((error: unknown) => {
    console.error("Failed to seed constants.", error);
    process.exit(1);
  });
}
