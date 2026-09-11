import { useEffect, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Check, Loader2, Plug, Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { SettingsPageShell, SettingsRow } from "@/components/settings-shell";
import { Panel } from "@/components/ui-bits";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  fetchAiModelFiles,
  fetchAiProviders,
  importAiModelFile,
  removeAiModelFile,
  reparseAiModelFile,
  removeAiProvider,
  saveAiProvider,
  switchAiProvider,
  testAiConnection,
} from "@/lib/ai.functions";

export const Route = createFileRoute("/settings/ai")({
  head: () => ({
    meta: [
      { title: "AI 设置 | PlayFlow" },
      {
        name: "description",
        content: "在数据库里维护多套 AI 模型配置，支持本地清单文件导入、随时切换当前使用的模型与连接测试。",
      },
      { property: "og:title", content: "AI 设置 | PlayFlow" },
      { property: "og:description", content: "多套模型配置保存在平台数据库，可导入本地清单文件并一键切换。" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AiSettingsPage,
});

type Mode = "lovable" | "openai" | "anthropic" | "custom";

interface Provider {
  id: string;
  name: string;
  mode: string;
  baseUrl: string;
  models: string[];
  defaultModel: string;
  isActive: boolean;
  note: string;
  apiKeyMask: string;
  hasApiKey: boolean;
  updatedAt: string;
}

interface ModelFile {
  id: string;
  providerId: string;
  filename: string;
  format: string;
  size: number;
  modelCount: number;
  createdAt: string;
}

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

const emptyForm = {
  id: "",
  name: "",
  mode: "openai" as Mode,
  baseUrl: "",
  apiKey: "",
  models: [] as string[],
  defaultModel: "",
  note: "",
};

function AiSettingsPage() {


  const loadProviders = useServerFn(fetchAiProviders);
  const saveProvider = useServerFn(saveAiProvider);
  const deleteProvider = useServerFn(removeAiProvider);
  const activate = useServerFn(switchAiProvider);
  const importFile = useServerFn(importAiModelFile);
  const loadFiles = useServerFn(fetchAiModelFiles);
  const reparseFile = useServerFn(reparseAiModelFile);
  const deleteFile = useServerFn(removeAiModelFile);
  const test = useServerFn(testAiConnection);

  const [providers, setProviders] = useState<Provider[]>([]);
  const [files, setFiles] = useState<ModelFile[]>([]);
  const [form, setForm] = useState({ ...emptyForm });
  const [newModel, setNewModel] = useState("");


  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const editing = providers.find((p) => p.id === form.id);

  useEffect(() => {
    void loadProviders()
      .then((list) => setProviders(list as Provider[]))
      .catch(() => toast.error("读取模型配置失败"));
    void loadFiles()
      .then((list) => setFiles(list as ModelFile[]))
      .catch(() => undefined);


    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editProvider = (p: Provider) => {
    setForm({
      id: p.id,
      name: p.name,
      mode: (p.mode as Mode) || "openai",
      baseUrl: p.baseUrl,
      apiKey: "",
      models: p.models,
      defaultModel: p.defaultModel,
      note: p.note,
    });
    setResult("");
  };

  const doSaveProvider = async () => {
    if (!form.name.trim()) {
      toast.error("请填写配置名称");
      return;
    }
    setBusy(true);
    try {
      const list = await saveProvider({
        data: {
          ...(form.id ? { id: form.id } : {}),
          name: form.name.trim(),
          mode: form.mode,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
          models: form.models,
          defaultModel: form.defaultModel,
          note: form.note,
        },
      });
      setProviders(list as Provider[]);
      setForm({ ...emptyForm });
      toast.success(form.id ? "配置已更新" : "配置已保存到数据库");
    } catch (e) {
      toast.error(`保存失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doActivate = async (id: string) => {
    setBusy(true);
    try {
      const list = await activate({ data: { id } });
      setProviders(list as Provider[]);
      toast.success(id ? "已切换当前使用的模型配置" : "已切回内置 Lovable AI");
    } catch (e) {
      toast.error(`切换失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async (id: string) => {
    setBusy(true);
    try {
      const list = await deleteProvider({ data: { id } });
      setProviders(list as Provider[]);
      if (form.id === id) setForm({ ...emptyForm });
      toast.success("配置已删除");
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File) => {
    setBusy(true);
    try {
      const content = await file.text();
      const res = await importFile({
        data: { filename: file.name, content, targetProviderId: form.id || "" },
      });
      setProviders(res.providers as Provider[]);
      setFiles(res.files as ModelFile[]);
      const target = (res.providers as Provider[]).find((p) => p.id === form.id);
      if (target) setForm((f) => ({ ...f, models: target.models, defaultModel: target.defaultModel }));
      toast.success(`导入完成：新增 ${res.addedProviders} 套配置、${res.addedModels} 个模型`);
    } catch (e) {
      toast.error(`导入失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const doReparse = async (id: string) => {
    setBusy(true);
    try {
      const res = await reparseFile({ data: { id, targetProviderId: form.id || "" } });
      setProviders(res.providers as Provider[]);
      setFiles(res.files as ModelFile[]);
      toast.success(`已按原文重新解析：新增 ${res.addedProviders} 套配置、${res.addedModels} 个模型`);
    } catch (e) {
      toast.error(`重新解析失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doDeleteFile = async (id: string) => {
    setBusy(true);
    try {
      setFiles((await deleteFile({ data: { id } })) as ModelFile[]);
      toast.success("清单文件已删除");
    } catch (e) {
      toast.error(`删除失败：${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const doTest = async () => {
    setBusy(true);
    setResult("");
    try {
      const r = await test({
        data: {
          providerId: form.id,
          mode: form.mode,
          baseUrl: form.baseUrl,
          apiKey: form.apiKey,
          model: form.defaultModel,
        },
      });
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
    if (!v || form.models.includes(v)) return;
    setForm((f) => ({ ...f, models: [...f.models, v], defaultModel: f.defaultModel || v }));
    setNewModel("");
  };

  const activeProvider = providers.find((p) => p.isActive);

  return (
    <SettingsPageShell
      title="AI 设置"
      desc="多套模型配置保存在平台数据库，可从本地清单文件导入，并随时切换当前使用的配置"
      showSave={false}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="已保存的模型配置">
          <div className="space-y-3">
            <p className="text-muted-foreground text-xs">
              当前使用：
              {activeProvider
                ? `${activeProvider.name} · ${activeProvider.defaultModel || "未指定默认模型"}`
                : "内置 Lovable AI"}
            </p>

            {providers.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                还没有保存任何配置，右侧新增一套，或直接导入本地模型清单文件。
              </p>
            ) : (
              <div className="space-y-1.5">
                {providers.map((p) => (
                  <div key={p.id} className="rounded-lg border px-3 py-2 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{p.name}</span>
                          {p.isActive && (
                            <span className="text-primary inline-flex items-center gap-1 text-xs">
                              <Check className="size-3" />
                              使用中
                            </span>
                          )}
                        </div>
                        <p className="text-muted-foreground truncate text-xs">
                          {MODE_LABEL[(p.mode as Mode) ?? "openai"] ?? p.mode} · {p.models.length} 个模型
                          {p.defaultModel ? ` · 默认 ${p.defaultModel}` : ""}
                          {p.hasApiKey ? ` · 密钥 ${p.apiKeyMask}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          size="sm"
                          variant={p.isActive ? "default" : "outline"}
                          disabled={busy || p.isActive}
                          onClick={() => void doActivate(p.id)}
                        >
                          {p.isActive ? "使用中" : "切换使用"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => editProvider(p)}>
                          编辑
                        </Button>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => void doDelete(p.id)}
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void doActivate("")}>
                改用内置模型
              </Button>
              <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
                <Upload className="mr-1 size-4" />
                导入本地清单文件
              </Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json,.csv,.txt"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void doImport(file);
                }}
              />
            </div>
            <p className="text-muted-foreground text-xs">
              支持 JSON（整套配置或模型名数组）、CSV（模型名,地址,密钥,名称）和纯文本（每行一个模型名）。只含模型名时会并入正在编辑或当前使用的配置。
            </p>
          </div>
        </Panel>

        <Panel title={editing ? `编辑配置：${editing.name}` : "新增模型配置"}>
          <div className="space-y-4">
            <SettingsRow label="配置名称" hint="便于区分不同环境或不同服务商">
              <Input
                value={form.name}
                placeholder="例如 生产 OpenAI 网关"
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </SettingsRow>

            <SettingsRow label="接入模式" hint="默认使用平台内置模型，可切换为自有服务">
              <Select value={form.mode} onValueChange={(v) => setForm((f) => ({ ...f, mode: v as Mode }))}>
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

            <SettingsRow label="服务地址" hint={BASE_HINT[form.mode]}>
              <Input
                value={form.baseUrl}
                disabled={form.mode === "lovable"}
                placeholder={form.mode === "lovable" ? "内置模型无需填写" : "https://..."}
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              />
            </SettingsRow>

            <SettingsRow
              label="API Key"
              hint={
                form.mode === "lovable"
                  ? "内置模型无需密钥"
                  : editing?.hasApiKey
                    ? `已保存：${editing.apiKeyMask}，留空表示保持不变`
                    : "密钥只保存在服务端，不会回传到浏览器"
              }
            >
              <Input
                type="password"
                value={form.apiKey}
                disabled={form.mode === "lovable"}
                placeholder={editing?.apiKeyMask || "sk-..."}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              />
            </SettingsRow>

            <div className="space-y-2">
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
              {form.models.length === 0 ? (
                <p className="text-muted-foreground text-xs">未添加模型时使用平台内置模型。</p>
              ) : (
                <div className="space-y-1.5">
                  {form.models.map((m) => (
                    <div
                      key={m}
                      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
                    >
                      <span className="truncate">{m}</span>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant={form.defaultModel === m ? "default" : "outline"}
                          onClick={() => setForm((f) => ({ ...f, defaultModel: m }))}
                        >
                          {form.defaultModel === m ? "默认模型" : "设为默认"}
                        </Button>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            setForm((f) => ({
                              ...f,
                              models: f.models.filter((x) => x !== m),
                              defaultModel: f.defaultModel === m ? "" : f.defaultModel,
                            }))
                          }
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={doSaveProvider} disabled={busy}>
                {busy ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}
                {form.id ? "更新配置" : "保存配置"}
              </Button>
              <Button variant="outline" onClick={doTest} disabled={busy}>
                <Plug className="mr-1 size-4" />
                测试连接
              </Button>
              {form.id && (
                <Button variant="ghost" onClick={() => setForm({ ...emptyForm })} disabled={busy}>
                  取消编辑
                </Button>
              )}
            </div>
            {result && <p className="text-muted-foreground text-xs">{result}</p>}
          </div>
        </Panel>

        <Panel title="已入库的模型清单文件">
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs">
              上传的清单文件原文会完整保存在平台数据库里，平台和客户端启动后都从这里加载模型，不依赖任何外部清单。
            </p>
            {files.length === 0 ? (
              <p className="text-muted-foreground text-xs">还没有上传过清单文件。</p>
            ) : (
              <div className="space-y-1.5">
                {files.map((f) => (
                  <div key={f.id} className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{f.filename}</p>
                      <p className="text-muted-foreground truncate text-xs">
                        {f.format.toUpperCase()} · {f.modelCount} 个模型 · {Math.max(1, Math.round(f.size / 1024))} KB
                        {f.createdAt ? ` · ${new Date(f.createdAt).toLocaleString("zh-CN")}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => void doReparse(f.id)}>
                        重新解析
                      </Button>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => void doDeleteFile(f.id)}
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

        <Panel title="客户端 AI 设置">
          <p className="text-muted-foreground text-xs leading-relaxed">
            这里的模型只用于平台的「AI 报告分析」。客户端的 AI 助手（对话生成用例、页面元素定位）
            在客户端「内核与维护 → AI 助手设置」里单独配置：可以填本机模型，也可以留空转发到平台模型；
            页面抓取的截图、缓存和重试次数也在客户端设置，因为抓取跑在本机浏览器上。
          </p>
        </Panel>

      </div>
    </SettingsPageShell>
  );
}
