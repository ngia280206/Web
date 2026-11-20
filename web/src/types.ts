export type Resource = 'dishes' | 'chefs' | 'ingredients';
export type ChefReference = { id: number | string; name: string; specialty: string };
export type IngredientReference = { id: number | string; name: string; unit: string };
export type Entry = { id: number | string; name: string; description?: string; price?: number; category?: string; available?: boolean; specialty?: string; unit?: string; imageUrl?: string | null; chef?: ChefReference | null; ingredients?: IngredientReference[]; source?: string; sourceId?: string | null; syntheticPrice?: boolean; syntheticCategory?: boolean; chefId?: number | string | null };
