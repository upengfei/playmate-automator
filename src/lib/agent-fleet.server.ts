/** Published Agent metadata shared by the download page, version API and upgrade decisions. */
import { z } from "zod";
import { localClient, updateAgentRelease } from "./local-db.server";
import { artifactTarget } from "./agent-artifacts";

export interface ReleaseArtifact {
  platform: "win" | "darwin" | "linux";
  file: string;
  sizeMB: number;
  sha256: string;
  url: string;
}

export interface Release {
  version: string;
  channel: string;
  publishedAt: string;
  minSupported: string;
  notes: string[];
  artifacts: ReleaseArtifact[];
}

export interface ReleaseSync {
  status: "empty" | "syncing" | "synced" | "failed";
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  retryAt: string | null;
  message: string;
}

export interface ReleaseState {
  release: Release | null;
  sync: ReleaseSync;
}

const REPOSITORY = "upengfei/playmate-automator";
const API = `https://api.github.com/repos/${REPOSITORY}/releases`;
const CACHE_MS = 5 * 60_000;
const RETRY_MS = 60_000;
const versionSchema = z
  .string()
  .max(32)
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  .refine((v) => v.split(".").every((n) => Number.isSafeInteger(Number(n))));
export const manifestSchema = z.object({
  version: versionSchema,
  channel: z.string().max(20).optional(),
  publishedAt: z.string().max(40).optional(),
  minSupported: versionSchema.optional(),
  notes: z.array(z.string().max(10000)).max(100).optional(),
  artifacts: z
    .array(
      z.object({
        platform: z.enum(["win", "darwin", "linux"]),
        file: z.string().min(3).max(160),
        sizeMB: z.number().nonnegative(),
        sha256: z.string().regex(/^[a-fA-F0-9]{64}$/),
        url: z.string().url().optional(),
      }),
    )
    .min(1)
    .max(10),
});
export type ReleaseInput = z.infer<typeof manifestSchema>;

const assetSchema = z.object({
  name: z.string(),
  size: z.number(),
  state: z.string(),
  browser_download_url: z.string().url(),
  digest: z.string().nullable().optional(),
});
const githubSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().datetime({ offset: true }),
  body: z.string().nullable(),
  assets: z.array(assetSchema),
});

function stableRelease(value: unknown): boolean {
  const candidate = z
    .object({ tag_name: z.string(), draft: z.boolean(), prerelease: z.boolean() })
    .safeParse(value);
  return (
    candidate.success &&
    !candidate.data.draft &&
    !candidate.data.prerelease &&
    candidate.data.tag_name.startsWith("agent-v") &&
    versionSchema.safeParse(candidate.data.tag_name.slice(7)).success
  );
}

function assetUrl(tag: string, file: string) {
  return `https://github.com/${REPOSITORY}/releases/download/${tag}/${file}`;
}

function artifactIdentity(artifacts: { file: string; sha256: string }[]) {
  return artifacts
    .map((a) => `${a.file}:${a.sha256.toLowerCase()}`)
    .sort()
    .join("\n");
}

function validateArtifacts(
  manifest: ReleaseInput,
  github: z.infer<typeof githubSchema>,
): ReleaseArtifact[] {
  if (!stableRelease(github) || github.tag_name !== `agent-v${manifest.version}`)
    throw new Error("发布标签与稳定版本不一致");
  const targets = new Set<string>();
  const artifacts = manifest.artifacts.map((a) => {
    const target = artifactTarget(a.file);
    const targetKey = target && `${target.platform}-${target.arch}`;
    if (
      !target ||
      target.platform !== a.platform ||
      !a.file.startsWith(`PlayFlowAgent-${manifest.version}-`) ||
      targets.has(targetKey!)
    )
      throw new Error("发布文件的版本、平台或架构不一致");
    targets.add(targetKey!);
    const assets = github.assets.filter((asset) => asset.name === a.file);
    const asset = assets[0];
    const expectedUrl = assetUrl(github.tag_name, a.file);
    if (
      assets.length !== 1 ||
      !asset ||
      asset.state !== "uploaded" ||
      asset.size <= 0 ||
      asset.browser_download_url !== expectedUrl ||
      (a.url && a.url !== expectedUrl)
    )
      throw new Error("发布安装包未就绪或下载地址不一致");
    const sha256 = a.sha256.toLowerCase();
    if (asset.digest && asset.digest.toLowerCase() !== `sha256:${sha256}`)
      throw new Error("发布安装包 SHA256 不一致");
    return {
      ...a,
      sha256,
      url: expectedUrl,
      sizeMB: Math.round((asset.size / 1048576) * 100) / 100,
    };
  });
  if (
    targets.size !== 3 ||
    !["win-x64", "darwin-arm64", "linux-x64"].every((key) => targets.has(key))
  ) {
    throw new Error("发布清单必须包含 Windows x64、macOS ARM64 和 Linux x64 安装包");
  }
  return artifacts;
}

export function artifactUrl(file: string): string {
  const version = file.match(/^PlayFlowAgent-(\d+\.\d+\.\d+)-/)?.[1];
  const base =
    process.env["AGENT_DOWNLOAD_BASE"] ||
    `https://github.com/${REPOSITORY}/releases/download/agent-v${version}`;
  return `${base.replace(/\/+$/, "")}/${file}`;
}

function mapRow(row: Record<string, unknown>): Release {
  const input = manifestSchema.parse({
    version: row["version"],
    channel: row["channel"] ?? "稳定版",
    publishedAt: row["published_at"] ?? "",
    minSupported: row["min_supported"] ?? "0.0.0",
    notes: row["notes"] ?? [],
    artifacts: (Array.isArray(row["artifacts"]) ? row["artifacts"] : []).map((a) => ({
      ...a,
      platform: artifactTarget(String(a.file))?.platform ?? a.platform,
      url: a.url || artifactUrl(String(a.file)),
    })),
  });
  return {
    ...input,
    channel: input.channel!,
    publishedAt: input.publishedAt!,
    minSupported: input.minSupported!,
    notes: input.notes!,
    artifacts: input.artifacts.map((a) => ({ ...a, url: a.url! })),
  };
}

/** Only HTTP and the clock are replaceable; persistence uses the platform's real SQLite store. */
export function createReleaseService(
  dependencies: { fetch?: typeof fetch; now?: () => number } = {},
) {
  const request = dependencies.fetch ?? fetch;
  const clock = dependencies.now ?? Date.now;
  let release: Release | null = null;
  let inflight: Promise<ReleaseState> | null = null;
  let nextAttempt = 0;
  let sync: ReleaseSync = {
    status: "empty",
    lastAttemptAt: null,
    lastSuccessAt: null,
    retryAt: null,
    message: "尚未同步 Agent 发布版本",
  };
  const state = (): ReleaseState => ({ release, sync: { ...sync } });

  async function restore() {
    const { data, error } = await localClient()
      .from("agent_releases")
      .select("*")
      .eq("is_current", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("读取发布记录失败");
    if (data) {
      release = mapRow(data as Record<string, unknown>);
      sync.lastSuccessAt = data.synced_at ?? null;
      if (sync.status === "empty" && sync.lastSuccessAt) {
        sync.status = "synced";
        sync.message = "已读取上次有效的发布版本";
        nextAttempt = Date.parse(sync.lastSuccessAt) + RETRY_MS;
      }
    }
  }

  async function getJson(url: string, signal: AbortSignal, allowMissing = false) {
    const response = await request(url, {
      signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) {
      const after = response.headers.get("retry-after");
      const retry =
        after && /^\d+$/.test(after) ? clock() + Number(after) * 1000 : Date.parse(after ?? "");
      const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
      nextAttempt = Math.max(
        nextAttempt,
        Number.isFinite(retry) ? retry : 0,
        response.headers.get("x-ratelimit-remaining") === "0" ? reset : 0,
      );
      throw new Error(`GitHub 请求失败（${response.status}），请稍后重试`);
    }
    return response.json();
  }

  async function latest(signal: AbortSignal) {
    const candidate: unknown = await getJson(`${API}/latest`, signal, true);
    if (stableRelease(candidate)) return githubSchema.parse(candidate);
    const candidates: z.infer<typeof githubSchema>[] = [];
    for (let page = 1; page <= 3; page++) {
      const rows = z
        .array(z.unknown())
        .parse(await getJson(`${API}?per_page=30&page=${page}`, signal));
      candidates.push(...rows.filter(stableRelease).map((row) => githubSchema.parse(row)));
      if (rows.length < 30) break;
    }
    candidates.sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at));
    if (!candidates[0]) throw new Error("尚未找到正式 Agent 发布");
    return candidates[0];
  }

  async function save(input: Release) {
    manifestSchema.parse(input);
    const syncedAt = new Date(clock()).toISOString();
    const row = await updateAgentRelease((current) => {
      let previous: Release | null = null;
      try {
        previous = current ? mapRow(current) : null;
      } catch {
        /* Invalid legacy data is replaceable. */
      }
      if (previous) {
        if (compareVersion(previous.version, input.version) > 0)
          throw new Error("拒绝回退到更旧的发布版本");
        if (
          previous.version === input.version &&
          artifactIdentity(previous.artifacts) !== artifactIdentity(input.artifacts)
        ) {
          throw new Error("同版本安装包已发生变化，请发布新版本");
        }
      }
      return {
        version: input.version,
        channel: input.channel,
        published_at: input.publishedAt,
        min_supported: input.minSupported,
        notes: input.notes,
        artifacts: input.artifacts,
        synced_at: syncedAt,
      };
    });
    release = mapRow(row);
    sync = {
      ...sync,
      status: "synced",
      lastSuccessAt: syncedAt,
      message: "已同步 GitHub 发布版本",
    };
  }

  async function synchronize(input?: ReleaseInput) {
    nextAttempt = clock() + RETRY_MS;
    sync = {
      ...sync,
      status: "syncing",
      lastAttemptAt: new Date(clock()).toISOString(),
      message: "正在同步发布版本",
    };
    try {
      input = input ? manifestSchema.parse(input) : undefined;
      const signal = AbortSignal.timeout(20000);
      const github = input
        ? githubSchema.parse(await getJson(`${API}/tags/agent-v${input.version}`, signal))
        : await latest(signal);
      const manifestAsset = github.assets.find((a) => a.name === "agent-release.json");
      if (
        !manifestAsset ||
        manifestAsset.state !== "uploaded" ||
        manifestAsset.size <= 0 ||
        manifestAsset.browser_download_url !== assetUrl(github.tag_name, "agent-release.json")
      )
        throw new Error("发布清单尚未上传或地址不一致");
      const uploaded = manifestSchema.parse(
        await getJson(manifestAsset.browser_download_url, signal),
      );
      if (
        input &&
        (input.version !== uploaded.version ||
          artifactIdentity(validateArtifacts(input, github)) !==
            artifactIdentity(validateArtifacts(uploaded, github)))
      ) {
        throw new Error("CI 登记与已上传的发布清单不一致");
      }
      const manifest = { ...input, ...uploaded };
      await save({
        ...manifest,
        channel: manifest.channel ?? "稳定版",
        publishedAt: github.published_at,
        minSupported: manifest.minSupported ?? release?.minSupported ?? "0.0.0",
        notes: manifest.notes ?? (github.body ? [github.body] : []),
        artifacts: validateArtifacts(manifest, github),
      });
    } catch (error) {
      // A different worker may have published a newer release while this request was in flight.
      try {
        await restore();
      } catch {
        /* Keep the in-memory last known good release. */
      }
      sync = {
        ...sync,
        status: "failed",
        message:
          error instanceof z.ZodError
            ? "发布清单格式不合法"
            : error instanceof Error
              ? error.message
              : "发布同步失败",
      };
    }
    sync.retryAt = new Date(nextAttempt).toISOString();
    return state();
  }

  function start(input?: ReleaseInput) {
    inflight = synchronize(input).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  return {
    async read(options: { force?: boolean } = {}): Promise<ReleaseState> {
      try {
        await restore();
      } catch {
        /* Synchronization can recover an empty or unreadable store. */
      }
      if (inflight) return options.force || !release ? inflight : state();
      if (clock() < nextAttempt)
        return { ...state(), sync: { ...sync, retryAt: new Date(nextAttempt).toISOString() } };
      const fresh =
        sync.status === "synced" &&
        sync.lastSuccessAt &&
        clock() - Date.parse(sync.lastSuccessAt) < CACHE_MS;
      if (!options.force && fresh) return state();
      const pending = start();
      return options.force || !release ? pending : state();
    },
    async publish(input: ReleaseInput) {
      try {
        await restore();
      } catch {
        /* Saving must still succeed before reporting success. */
      }
      while (inflight) await inflight;
      const result = await start(input);
      return { ok: result.sync.status === "synced", message: result.sync.message };
    },
  };
}

const service = createReleaseService();
export const readRelease = service.read;
export const publishRelease = service.publish;

export interface UpgradeReport {
  agentId: string;
  ok: boolean;
  message: string;
  installedVersion: string;
  fromVersion?: string;
  durationMs?: number;
  reportedAt: string;
}

export function compareVersion(a: string, b: string): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
