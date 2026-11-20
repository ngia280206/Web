-- Chỉ cần chạy trên database MỚI trong Supabase SQL Editor.
-- Nếu dùng database hiện tại của bản SSR, giữ nguyên schema/dữ liệu đang có.
-- Schema khớp DB_SCHEMA_STYLE=prisma trong .env.
BEGIN;

CREATE TABLE IF NOT EXISTS public.chefs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  specialty TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.ingredients (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public.dishes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  price INT NOT NULL CHECK (price >= 0),
  category TEXT,
  "imageUrl" TEXT,
  available BOOLEAN NOT NULL DEFAULT TRUE,
  "chefId" INT REFERENCES public.chefs(id) ON DELETE SET NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS public."_DishToIngredient" (
  "A" INT NOT NULL REFERENCES public.dishes(id) ON DELETE CASCADE,
  "B" INT NOT NULL REFERENCES public.ingredients(id) ON DELETE CASCADE,
  PRIMARY KEY ("A", "B")
);
CREATE INDEX IF NOT EXISTS "_DishToIngredient_B_index" ON public."_DishToIngredient" ("B");
CREATE INDEX IF NOT EXISTS dishes_chef_index ON public.dishes ("chefId");

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  dob DATE,
  role TEXT NOT NULL DEFAULT 'user',
  failed_login_attempts INT NOT NULL DEFAULT 0,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  unlock_token TEXT UNIQUE,
  unlock_token_expires TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Browser chỉ gọi backend Express. Backend dùng service role; không cho anon
-- truy cập trực tiếp dữ liệu qua Supabase REST API trên database mới.
ALTER TABLE public.chefs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dishes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."_DishToIngredient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.chefs, public.ingredients, public.dishes, public."_DishToIngredient", public.profiles TO service_role;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;

COMMIT;
