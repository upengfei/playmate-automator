CREATE TABLE public.agent_releases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  version text NOT NULL UNIQUE,
  channel text NOT NULL DEFAULT '稳定版',
  published_at date NOT NULL DEFAULT now(),
  min_supported text NOT NULL DEFAULT '0.0.0',
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  artifacts jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_current boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.agent_releases TO service_role;
ALTER TABLE public.agent_releases ENABLE ROW LEVEL SECURITY;

INSERT INTO public.agent_releases (version, channel, published_at, min_supported, notes, artifacts, is_current)
VALUES (
  '1.8.2', '稳定版', '2026-09-05', '1.6.0',
  '["内置 Playwright 1.47 执行内核，录制器支持 Shadow DOM 选择器","任务下发通道改为长连接，断线后自动补传执行日志","新增静默安装与后台自动更新（支持回滚到上一个版本）"]'::jsonb,
  '[{"platform":"win","file":"PlayFlowAgent-1.8.2-win-x64.zip","sizeMB":135.0,"sha256":"3aae7899c54411b6b6a61b10efbed815e333128645abcfdadfe8cef28ab608c0"},{"platform":"darwin","file":"PlayFlowAgent-1.8.2-darwin-arm64.zip","sizeMB":325.0,"sha256":"9aa9933e4d8422787ff5563e1fd5e2aec92422b56e96bf80449d69fdd3bd95e8"},{"platform":"linux","file":"PlayFlowAgent-1.8.2-linux-x64.tar.gz","sizeMB":110.0,"sha256":"947d136eb25fa7c2a0ae110e421092980f97e465c3c07e4ee79782a3c3bde0ab"}]'::jsonb,
  true
);