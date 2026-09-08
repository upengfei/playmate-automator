CREATE TABLE public.agents (
  id text PRIMARY KEY,
  name text NOT NULL,
  host text NOT NULL DEFAULT '',
  os text NOT NULL DEFAULT '',
  ip text NOT NULL DEFAULT '',
  version text NOT NULL DEFAULT '0.0.0',
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT '在线',
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.agents TO anon, authenticated;
GRANT ALL ON public.agents TO service_role;
ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agents public read" ON public.agents FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.agent_tokens (
  agent_id text PRIMARY KEY REFERENCES public.agents(id) ON DELETE CASCADE,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.agent_tokens TO service_role;
ALTER TABLE public.agent_tokens ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.test_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  module text NOT NULL DEFAULT '未分类',
  start_url text NOT NULL DEFAULT '',
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  script text NOT NULL DEFAULT '',
  source text NOT NULL DEFAULT '平台编写',
  priority text NOT NULL DEFAULT 'P1',
  agent_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.test_cases TO anon, authenticated;
GRANT ALL ON public.test_cases TO service_role;
ALTER TABLE public.test_cases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cases public read" ON public.test_cases FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.case_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid REFERENCES public.test_cases(id) ON DELETE CASCADE,
  case_name text NOT NULL DEFAULT '',
  agent_id text,
  status text NOT NULL DEFAULT '执行中',
  duration_ms integer,
  error text,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT ON public.case_runs TO anon, authenticated;
GRANT ALL ON public.case_runs TO service_role;
ALTER TABLE public.case_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "runs public read" ON public.case_runs FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.run_logs (
  id bigserial PRIMARY KEY,
  run_id uuid REFERENCES public.case_runs(id) ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.run_logs TO anon, authenticated;
GRANT ALL ON public.run_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.run_logs_id_seq TO service_role;
ALTER TABLE public.run_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "run logs public read" ON public.run_logs FOR SELECT TO anon, authenticated USING (true);

CREATE INDEX run_logs_run_idx ON public.run_logs(run_id, id);
CREATE INDEX case_runs_agent_idx ON public.case_runs(agent_id, started_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.agents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.test_cases;
ALTER PUBLICATION supabase_realtime ADD TABLE public.case_runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.run_logs;