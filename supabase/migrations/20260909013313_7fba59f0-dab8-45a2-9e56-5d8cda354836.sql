ALTER TABLE public.test_cases ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
ALTER TABLE public.case_runs ADD COLUMN IF NOT EXISTS case_version integer;

CREATE TABLE IF NOT EXISTS public.case_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES public.test_cases(id) ON DELETE CASCADE,
  version integer NOT NULL,
  name text NOT NULL DEFAULT '',
  module text NOT NULL DEFAULT '未分类',
  priority text NOT NULL DEFAULT 'P1',
  start_url text NOT NULL DEFAULT '',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  script text NOT NULL DEFAULT '',
  note text NOT NULL DEFAULT '',
  author text NOT NULL DEFAULT '平台',
  source text NOT NULL DEFAULT '平台编写',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (case_id, version)
);

GRANT SELECT ON public.case_versions TO anon;
GRANT SELECT ON public.case_versions TO authenticated;
GRANT ALL ON public.case_versions TO service_role;

ALTER TABLE public.case_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "case versions public read" ON public.case_versions FOR SELECT TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS case_versions_case_idx ON public.case_versions (case_id, version DESC);