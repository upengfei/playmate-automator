ALTER TABLE public.test_cases
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS author text NOT NULL DEFAULT '平台',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT '就绪';

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS cpu integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS memory integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS concurrency integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS total_runs integer NOT NULL DEFAULT 0;

CREATE TABLE public.tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  env text NOT NULL DEFAULT '测试环境',
  browser text NOT NULL DEFAULT 'Chromium',
  agent_id text,
  concurrency integer NOT NULL DEFAULT 2,
  retry integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT '排队中',
  stage text NOT NULL DEFAULT '等待下发',
  trigger text NOT NULL DEFAULT '手动',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT ON public.tasks TO anon;
GRANT SELECT ON public.tasks TO authenticated;
GRANT ALL ON public.tasks TO service_role;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tasks public read" ON public.tasks FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE public.task_logs (
  id bigserial PRIMARY KEY,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL DEFAULT '',
  at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.task_logs TO anon;
GRANT SELECT ON public.task_logs TO authenticated;
GRANT ALL ON public.task_logs TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.task_logs_id_seq TO service_role;
ALTER TABLE public.task_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "task logs public read" ON public.task_logs FOR SELECT TO anon, authenticated USING (true);

ALTER TABLE public.case_runs
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS step_index integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS step_total integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS case_runs_task_idx ON public.case_runs(task_id);

CREATE TABLE public.platform_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  platform_name text NOT NULL DEFAULT 'PlayFlow 自动化测试平台',
  min_agent_version text NOT NULL DEFAULT '1.8.0',
  heartbeat_timeout_sec integer NOT NULL DEFAULT 60,
  default_retry integer NOT NULL DEFAULT 1,
  default_concurrency integer NOT NULL DEFAULT 2,
  keep_report_days integer NOT NULL DEFAULT 30,
  notify_email text NOT NULL DEFAULT '',
  notify_on_failure boolean NOT NULL DEFAULT true,
  auto_dispatch boolean NOT NULL DEFAULT true,
  video_on_failure boolean NOT NULL DEFAULT true,
  trace_mode text NOT NULL DEFAULT '仅失败',
  auto_upgrade boolean NOT NULL DEFAULT true,
  update_channel text NOT NULL DEFAULT '稳定版',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_settings TO anon;
GRANT SELECT ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings public read" ON public.platform_settings FOR SELECT TO anon, authenticated USING (true);
INSERT INTO public.platform_settings (id) VALUES (1);

CREATE TABLE public.agent_upgrades (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id text NOT NULL,
  agent_name text NOT NULL DEFAULT '',
  from_version text NOT NULL DEFAULT '0.0.0',
  to_version text NOT NULL DEFAULT '0.0.0',
  channel text NOT NULL DEFAULT '稳定版',
  trigger text NOT NULL DEFAULT '手动推送',
  stage text NOT NULL DEFAULT '排队中',
  progress integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT '进行中',
  report jsonb,
  logs jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
GRANT SELECT ON public.agent_upgrades TO anon;
GRANT SELECT ON public.agent_upgrades TO authenticated;
GRANT ALL ON public.agent_upgrades TO service_role;
ALTER TABLE public.agent_upgrades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "upgrades public read" ON public.agent_upgrades FOR SELECT TO anon, authenticated USING (true);
CREATE INDEX IF NOT EXISTS agent_upgrades_agent_idx ON public.agent_upgrades(agent_id, started_at DESC);