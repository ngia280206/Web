-- Additive migration. Existing rows, IDs and relationships are preserved.
SET search_path = public, extensions, pg_catalog;
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- Register pg_trgm GUCs in this backend before setting a function-local threshold.
-- Pooler connections may use a backend that has not loaded the module yet.
SELECT word_similarity('catalog','catalog');
CREATE TABLE IF NOT EXISTS public.catalog_migrations(version integer PRIMARY KEY, applied_at timestamptz DEFAULT now());
CREATE TABLE IF NOT EXISTS public.catalog_import_batches(id text PRIMARY KEY, source text NOT NULL, started_at timestamptz DEFAULT now(), finished_at timestamptz, summary jsonb);
CREATE TABLE IF NOT EXISTS public.catalog_aliases(alias text PRIMARY KEY, canonical text NOT NULL);
CREATE TABLE IF NOT EXISTS public.dishes(id bigserial PRIMARY KEY, name text NOT NULL, description text NOT NULL, price numeric NOT NULL, category text NOT NULL, available boolean NOT NULL, "imageUrl" text, "chefId" bigint);
CREATE TABLE IF NOT EXISTS public.chefs(id bigserial PRIMARY KEY, name text NOT NULL, specialty text NOT NULL);
CREATE TABLE IF NOT EXISTS public.ingredients(id bigserial PRIMARY KEY, name text NOT NULL, unit text NOT NULL);
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS "imageUrl" text;
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS "chefId" bigint;
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'original';
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS "sourceId" text;
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS "sourceImageName" text;
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS "importBatchId" text;
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS "syntheticPrice" boolean NOT NULL DEFAULT false;
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS "syntheticCategory" boolean NOT NULL DEFAULT false;
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS "recipeInstructions" text;
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS "recipeIngredients" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS "searchName" text;
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS "searchText" text;
ALTER TABLE public.dishes ADD COLUMN IF NOT EXISTS "searchVector" tsvector;
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'original';
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS "sourceId" text;
ALTER TABLE public.ingredients ADD COLUMN IF NOT EXISTS "importBatchId" text;
CREATE TABLE IF NOT EXISTS public.catalog_recipe_ingredients(dish_id text NOT NULL, ingredient_id text NOT NULL, PRIMARY KEY(dish_id,ingredient_id));
CREATE UNIQUE INDEX IF NOT EXISTS catalog_dish_source_idx ON public.dishes(source,"sourceId") WHERE "sourceId" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS catalog_ingredient_source_idx ON public.ingredients(source,"sourceId") WHERE "sourceId" IS NOT NULL;

CREATE OR REPLACE FUNCTION public.catalog_normalize(value text) RETURNS text
LANGUAGE sql STABLE SET search_path = public, extensions, pg_catalog AS $$
  SELECT lower(unaccent(coalesce(value,'')));
$$;
CREATE OR REPLACE FUNCTION public.catalog_refresh_search() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, extensions, pg_catalog AS $$
BEGIN
  NEW."searchName" := public.catalog_normalize(NEW.name);
  NEW."searchText" := public.catalog_normalize(NEW.name || ' ' || coalesce(NEW.description,'') || ' ' || NEW."recipeIngredients"::text);
  NEW."searchVector" := setweight(to_tsvector('simple',NEW."searchName"),'A')
    || setweight(to_tsvector('simple',public.catalog_normalize(NEW.description)),'B')
    || setweight(to_tsvector('simple',public.catalog_normalize(NEW."recipeIngredients"::text)),'C');
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS catalog_search_refresh ON public.dishes;
CREATE TRIGGER catalog_search_refresh BEFORE INSERT OR UPDATE OF name,description,"recipeIngredients" ON public.dishes
FOR EACH ROW EXECUTE FUNCTION public.catalog_refresh_search();
UPDATE public.dishes SET name=name WHERE "searchVector" IS NULL;
CREATE INDEX IF NOT EXISTS catalog_dish_fts_idx ON public.dishes USING gin("searchVector");
CREATE INDEX IF NOT EXISTS catalog_dish_name_fts_idx ON public.dishes USING gin(to_tsvector('simple',"searchName"));
CREATE INDEX IF NOT EXISTS catalog_dish_trgm_idx ON public.dishes USING gin("searchName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_dish_text_trgm_idx ON public.dishes USING gin("searchText" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS catalog_dish_category_price_idx ON public.dishes(category,price,id);
INSERT INTO public.catalog_aliases VALUES ('bắp','ngô'),('đậu phộng','lạc'),('thơm','dứa') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.catalog_search(p_resource text,p_options jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = public, extensions, pg_catalog SET pg_trgm.word_similarity_threshold = '0.4' AS $$
DECLARE
  page_no int := greatest(1,coalesce((p_options->>'page')::int,1));
  page_size int := least(100,greatest(1,coalesce((p_options->>'pageSize')::int,12)));
  term text := public.catalog_normalize(p_options->>'q');
  requested text := coalesce(p_options->>'searchMode','auto');
  applied text := 'none'; scope_name text := coalesce(p_options->>'scope','name');
  sort_name text := coalesce(p_options->>'sort','newest');
  predicate text := 'true'; search_predicate text := 'true'; ordering text := 'id DESC';
  score_expr text := '0::real'; tsq tsquery; total bigint; result jsonb; alias_term text;
BEGIN
  IF p_resource NOT IN ('dishes','chefs','ingredients') THEN RAISE EXCEPTION 'Invalid resource'; END IF;
  IF p_resource <> 'dishes' THEN
    IF term <> '' THEN predicate := format('public.catalog_normalize(name) ILIKE %L', '%'||replace(replace(replace(term,E'\\',E'\\\\'),'%',E'\\%'),'_',E'\\_')||'%'); END IF;
    EXECUTE format('SELECT count(*) FROM public.%I WHERE %s',p_resource,predicate) INTO total;
    EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM (SELECT * FROM public.%I WHERE %s ORDER BY id DESC LIMIT $1 OFFSET $2) t',p_resource,predicate) INTO result USING page_size,(page_no-1)*page_size;
    applied := CASE WHEN term='' THEN 'none' ELSE 'substring' END;
  ELSE
    IF coalesce(p_options->>'category','')<>'' THEN predicate := predicate||format(' AND category=%L',p_options->>'category'); END IF;
    IF coalesce(p_options->>'available','')<>'' THEN predicate := predicate||format(' AND available=%L::boolean',p_options->>'available'); END IF;
    IF p_options->>'minPrice' IS NOT NULL THEN predicate := predicate||format(' AND (NOT "syntheticPrice" OR price>0) AND price >= %L::numeric',p_options->>'minPrice'); END IF;
    IF p_options->>'maxPrice' IS NOT NULL THEN predicate := predicate||format(' AND (NOT "syntheticPrice" OR price>0) AND price <= %L::numeric',p_options->>'maxPrice'); END IF;
    IF coalesce(p_options->>'chefId','')='unassigned' THEN predicate := predicate||' AND "chefId" IS NULL';
    ELSIF coalesce(p_options->>'chefId','')<>'' THEN predicate := predicate||format(' AND "chefId"::text=%L',p_options->>'chefId'); END IF;
    IF coalesce(p_options->>'hasImage','')='true' THEN predicate := predicate||' AND coalesce("imageUrl",'''')<>''''';
    ELSIF coalesce(p_options->>'hasImage','')='false' THEN predicate := predicate||' AND coalesce("imageUrl",'''')='''''; END IF;
    IF coalesce(p_options->>'source','')<>'' THEN predicate := predicate||format(' AND source=%L',p_options->>'source'); END IF;
    IF term<>'' THEN
      SELECT CASE WHEN public.catalog_normalize(a.alias)=term THEN public.catalog_normalize(a.canonical) ELSE public.catalog_normalize(a.alias) END INTO alias_term
      FROM public.catalog_aliases a WHERE public.catalog_normalize(a.alias)=term OR public.catalog_normalize(a.canonical)=term LIMIT 1;
      tsq := websearch_to_tsquery('simple',term);
      IF alias_term IS NOT NULL THEN tsq := tsq || websearch_to_tsquery('simple',alias_term); END IF;
      applied := 'fts';
      search_predicate := format('%s @@ %L::tsquery',CASE WHEN scope_name='all' THEN '"searchVector"' ELSE 'to_tsvector(''simple'',"searchName")' END,tsq::text);
      score_expr := format('ts_rank("searchVector",%L::tsquery)',tsq::text);
      EXECUTE 'SELECT count(*) FROM public.dishes WHERE '||predicate||' AND '||search_predicate INTO total;
      IF requested='fuzzy' OR (requested='auto' AND total=0) THEN
        applied := 'fuzzy';
        -- Indexed word similarity, application threshold 0.4 (covered by typo tests; not a probability).
        search_predicate := CASE WHEN length(term)<3 THEN 'false' ELSE format('%L <%% %s',term,CASE WHEN scope_name='all' THEN '"searchText"' ELSE '"searchName"' END) END;
        score_expr := format('word_similarity(%L,%s)',term,CASE WHEN scope_name='all' THEN '"searchText"' ELSE '"searchName"' END);
      END IF;
    END IF;
    predicate := predicate||' AND ('||search_predicate||')';
    EXECUTE 'SELECT count(*) FROM public.dishes WHERE '||predicate INTO total;
    ordering := CASE sort_name WHEN 'price_asc' THEN '("syntheticPrice" AND price<=0) ASC, price ASC, id ASC' WHEN 'price_desc' THEN '("syntheticPrice" AND price<=0) ASC, price DESC, id ASC' WHEN 'name' THEN 'name ASC,id ASC' WHEN 'relevance' THEN CASE WHEN term<>'' THEN score_expr||' DESC,id ASC' ELSE 'id DESC' END ELSE 'id DESC' END;
    EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM (SELECT id,name,description,price,category,available,"imageUrl","chefId",source,"sourceId","syntheticPrice","syntheticCategory" FROM public.dishes WHERE '||predicate||' ORDER BY '||ordering||' LIMIT $1 OFFSET $2) t' INTO result USING page_size,(page_no-1)*page_size;
  END IF;
  RETURN jsonb_build_object('data',result,'pagination',jsonb_build_object('page',page_no,'pageSize',page_size,'totalItems',total,'totalPages',ceil(total::numeric/page_size),'hasNextPage',page_no::bigint*page_size<total,'hasPreviousPage',total>0 AND page_no>1),
    'search',jsonb_build_object('requestedMode',requested,'appliedMode',applied,'fallbackApplied',requested='auto' AND applied='fuzzy','engine','postgresql'),'source','supabase');
END; $$;

CREATE OR REPLACE FUNCTION public.catalog_facets(p_resource text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_catalog AS $$
  SELECT jsonb_build_object('categories',CASE WHEN p_resource='dishes' THEN (SELECT coalesce(jsonb_agg(category ORDER BY category),'[]') FROM (SELECT DISTINCT category FROM public.dishes) c) ELSE '[]'::jsonb END,
    'chefs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name),'[]') FROM public.chefs));
$$;
REVOKE ALL ON FUNCTION public.catalog_search(text,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.catalog_facets(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.catalog_search(text,jsonb),public.catalog_facets(text) TO service_role;
ALTER TABLE public.catalog_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_aliases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catalog_recipe_ingredients ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.catalog_migrations,public.catalog_import_batches,public.catalog_aliases,public.catalog_recipe_ingredients TO service_role;
INSERT INTO public.catalog_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
