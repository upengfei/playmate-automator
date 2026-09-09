ALTER TABLE public.test_cases ADD COLUMN IF NOT EXISTS params jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.test_cases ADD COLUMN IF NOT EXISTS is_template boolean NOT NULL DEFAULT false;
ALTER TABLE public.case_versions ADD COLUMN IF NOT EXISTS params jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.param_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope text NOT NULL DEFAULT '环境',
  scope_key text NOT NULL DEFAULT '',
  name text NOT NULL,
  value text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (scope, scope_key, name)
);

GRANT SELECT ON public.param_bindings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.param_bindings TO authenticated;
GRANT ALL ON public.param_bindings TO service_role;
ALTER TABLE public.param_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "param bindings public read" ON public.param_bindings FOR SELECT TO anon, authenticated USING (true);