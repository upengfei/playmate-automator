import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plug, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { SettingsPageShell, SettingsRow } from "@/components/settings-shell";
import { Panel } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchAiSettings, saveAiSettings, testAiConnection } from "@/lib/ai.functions";

export const Route = createFileRoute("/settings/ai")({
  head: () => ({
    meta: [
      { title: "AI 设置 | PlayFlow" },
      {
        name: "description",
        content: "配置 AI 模型接入：内置 Lovable AI、OpenAI 兼容、Anthropic 兼容或自定义网关，并测试连接。",
      },
      { property: "og:title", content: "AI 设置 | PlayFlow" },
      { property: "og:description", content: "维护模型列表、默认模型与接入密钥，并一键测试连接可用性。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AiSettingsPage,
});

type Mode = "lovable" | "openai" | "anthropic" | "custom";

const MODE_LABEL: Record<Mode, string> = {
  lovable: "内置 Lovable AI（无需密钥）",
  openai: "OpenAI 兼容接口",
  anthropic: "Anthropic 兼容接口",
  custom: "自定义网关（OpenAI 协议）",
};

const BASE_HINT: Record<Mode, string> = {
  lovable: "使用平台内置模型，无需填写地址和密钥",
  openai: "例如 https://api.openai.com/v1",
  anthropic: "例如 https://api.anthropic.com",
  custom: "填写你自己的兼容网关地址，例如 https://gateway.example.com/v1",
};

function AiSettingsPage() {
  const load = useServerFn(fetchAiSettings);
  const save = useServerFn(saveAiSettings);
  const test = useServerFn(testAiConnection);

  const [mode, setMode] = useState<Mode>("lovable");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyMask, setApiKeyMask] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [defaultModel, setDefaultModel] = useState("");
  const [newModel, setNewModel] = useState("");
  const [cacheMinutes, setCacheMinutes] = useState(10);
  const [keepScreenshot, setKeepScreenshot] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string>("");

  useEffect(() => {
    void load()
      .then((s) => {
        setMode(s.mode as Mode);
        setBaseUrl(s.baseUrl);
        setApiKeyMask(s.apiKeyMask);
        setModels(s.models);
        setDefaultModel(s.defaultModel);
        setCacheMinutes(s.inspectCacheMinutes);
        setKeepScreenshot(s.inspectScreenshot);
      })
      .catch(() => toast.error("读取 AI 配置失败"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doSave = async () => {
    setBusy(true);
    try {
      const s = await save({
        data: {
          mode,
          baseUrl,
          apiKey,
          models,
          defaultModel,
          inspectCacheMinutes: cacheMinutes,
          inspectScreenshot: keepScreenshot,
        },
      });
      setApiKey("");
      setApiKeyMask(s.apiKeyMask);
      toast.success("AI 配置已保存并生效");
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doTest = async () => {
    setBusy(true);
    setResult("");
    try {
      const r = await test({ data: { mode, baseUrl, apiKey, model: defaultModel } });
      if (r.ok) {
        setResult(`连接成功：${r.label}，耗时 ${r.ms} ms，模型回复「${r.reply}」`);
        toast.success("连接测试通过");
      } else {
        setResult(`连接失败（${r.ms} ms）：${r.message}`);
        toast.error("连接测试失败");
      }
    } catch (e) {
      setResult(`连接失败：${(e as Error).message}`);
      toast.error("连接测试失败");
    } finally {
      setBusy(false);
    }
  };

  const addModel = () => {
    const v = newModel.trim();
    if (!v || models.includes(v)) return;
    setModels([...models, v]);
    if (!defaultModel) setDefaultModel(v);
    setNewModel("");
  };

  return (
    <SettingsPageShell
      title="AI 设置"
      desc="选择模型接入方式，自行维护模型列表与默认模型，并测试连接是否可用"
      showSave={false}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="模型接入">
          <div className="space-y-4">
            <SettingsRow label="接入模式" hint="默认使用平台内置模型，可切换为自有服务">
              <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MODE_LABEL) as Mode[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {MODE_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </SettingsRow>

            <SettingsRow label="服务地址" hint={BASE_HINT[mode]}>
              <Input
                value={baseUrl}
                disabled={mode === "lovable"}
                placeholder={mode === "lovable" ? "内置模型无需填写" : "https://..."}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </SettingsRow>

            <SettingsRow
              label="API Key"
              hint={
                mode === "lovable"
                  ? "内置模型无需密钥"
                  : apiKeyMask
                    ? `已保存：${apiKeyMask}，留空表示保持不变`
                    : "密钥只保存在服务端，不会回传到浏览器"
              }
            >
              <Input
                type="password"
                value={apiKey}
                disabled={mode === "lovable"}
                placeholder={apiKeyMask || "sk-..."}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </SettingsRow>

            <div className="flex gap-2">
              <Button onClick={doSave} disabled={busy}>
                {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                保存配置
              </Button>
              <Button variant="outline" onClick={doTest} disabled={busy}>
                <Plug className="mr-1 size-4" />
                测试连接
              </Button>
            </div>
            {result && <p className="text-muted-foreground text-xs">{result}</p>}
          </div>
        </Panel>

        <Panel title="模型列表">
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={newModel}
                placeholder="输入模型名称，例如 gpt-4.1 或 claude-sonnet-4"
                onChange={(e) => setNewModel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addModel();
                  }
                }}
              />
              <Button variant="outline" onClick={addModel}>
                <Plus className="size-4" />
              </Button>
            </div>

            {models.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                未添加模型时使用平台内置模型；添加后可指定默认模型。
              </p>
            ) : (
              <div className="space-y-1.5">
                {models.map((m) => (
                  <div
                    key={m}
                    className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                  >
                    <span className="truncate">{m}</span>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant={defaultModel === m ? "default" : "outline"}
                        onClick={() => setDefaultModel(m)}
                      >
                        {defaultModel === m ? "默认模型" : "设为默认"}
                      </Button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => {
                          setModels(models.filter((x) => x !== m));
                          if (defaultModel === m) setDefaultModel("");
                        }}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Panel>
        <Panel title="元素抓取">
          <div className="space-y-4">
            <SettingsRow
              label="缓存有效期（分钟）"
              hint="同一页面在有效期内再次抓取时直接用上次结果，客户端不再重开浏览器；填 0 表示每次都重新抓取"
            >
              <Input
                type="number"
                min={0}
                max={1440}
                value={cacheMinutes}
                onChange={(e) => setCacheMinutes(Number(e.target.value) || 0)}
              />
            </SettingsRow>
            <SettingsRow label="保存页面截图" hint="抓取元素时同时截一张页面截图，便于对照定位">
              <Switch checked={keepScreenshot} onCheckedChange={setKeepScreenshot} />
            </SettingsRow>
            <Button onClick={doSave} disabled={busy}>
              {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
              保存抓取设置
            </Button>
          </div>
        </Panel>
      </div>
    </SettingsPageShell>
  );
}
