import { z } from "zod";

// Input schema for creating a Post. Mirrors prisma/schema.prisma but only
// exposes user-writable fields (id/createdAt/updatedAt are DB-managed).
export const createPostSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(255),
  content: z.string().trim().max(10_000).optional(),
  published: z.boolean().default(false),
});

// Partial version for updates — every field optional.
export const updatePostSchema = createPostSchema.partial();

export type CreatePostInput = z.infer<typeof createPostSchema>;
export type UpdatePostInput = z.infer<typeof updatePostSchema>;
