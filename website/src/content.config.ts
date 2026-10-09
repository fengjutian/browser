import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const products = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/products' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    tagline: z.string(),
    category: z.string(),
    platforms: z.array(z.string()),
    status: z.enum(['development', 'beta', 'stable']),
    featured: z.boolean().default(false),
    icon: z.string().optional(),
    version: z.string(),
    updatedAt: z.coerce.date(),
    features: z.array(z.string()),
  }),
});

export const collections = { products };
