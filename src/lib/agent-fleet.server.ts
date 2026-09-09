/**
 * 桌面 Agent 车队服务端登记表（演示版：进程内存储）。
 * 记录发布清单、待处理的升级推送以及 Agent 回传的升级结果。
 */

export interface ReleaseArtifact {
  platform: "win" | "darwin" | "linux";
  file: string;
  sizeMB: number;
  sha256: string;
  url: string;
}

/**
 * 安装包下载地址前缀。配置 AGENT_DOWNLOAD_BASE（例如 CI 发布到 GitHub Release 后的
 * https://github.com/<owner>/<repo>/releases/latest/download/）时，版本接口与下载页
 * 直接返回公开地址；否则回退到站点内 /downloads/ 路径。
 */
export function artifactUrl(file: string): string {
  const base = process.env["AGENT_DOWNLOAD_BASE"];
  if (base) return `${base.replace(/\/+$/, "")}/${file}`;
  return `/downloads/${file}`;
}

export const RELEASE = {
  version: "1.8.2",
  channel: "稳定版",
  publishedAt: "2026-09-05",
  minSupported: "1.6.0",
  notes: [
    "内置 Playwright 1.47 执行内核，录制器支持 Shadow DOM 选择器",
    "任务下发通道改为长连接，断线后自动补传执行日志",
    "新增静默安装与后台自动更新（支持回滚到上一个版本）",
  ],
  artifacts: [
    {
      platform: "win",
      file: "PlayFlowAgent-1.8.2-win-x64.zip",
      sizeMB: 135.0,
      sha256: "3aae7899c54411b6b6a61b10efbed815e333128645abcfdadfe8cef28ab608c0",
      url: artifactUrl("PlayFlowAgent-1.8.2-win-x64.zip"),
    },
    {
      platform: "darwin",
      file: "PlayFlowAgent-1.8.2-darwin-arm64.zip",
      sizeMB: 325.0,
      sha256: "9aa9933e4d8422787ff5563e1fd5e2aec92422b56e96bf80449d69fdd3bd95e8",
      url: artifactUrl("PlayFlowAgent-1.8.2-darwin-arm64.zip"),
    },
    {
      platform: "linux",
      file: "PlayFlowAgent-1.8.2-linux-x64.tar.gz",
      sizeMB: 110.0,
      sha256: "947d136eb25fa7c2a0ae110e421092980f97e465c3c07e4ee79782a3c3bde0ab",
      url: artifactUrl("PlayFlowAgent-1.8.2-linux-x64.tar.gz"),
    },
  ] satisfies ReleaseArtifact[],
};

export interface UpgradeReport {
  agentId: string;
  ok: boolean;
  message: string;
  installedVersion: string;
  fromVersion?: string;
  durationMs?: number;
  reportedAt: string;
}

const pendingPushes = new Map<string, { jobId: string; toVersion: string; createdAt: string }>();
const reports: UpgradeReport[] = [];

export function queueUpgrade(agentId: string): { jobId: string; toVersion: string } {
  const jobId = `UP-${Date.now().toString(36).toUpperCase()}`;
  pendingPushes.set(agentId, {
    jobId,
    toVersion: RELEASE.version,
    createdAt: new Date().toISOString(),
  });
  return { jobId, toVersion: RELEASE.version };
}

export function takePendingUpgrade(agentId: string) {
  const job = pendingPushes.get(agentId);
  if (job) pendingPushes.delete(agentId);
  return job;
}

export function recordReport(report: UpgradeReport) {
  reports.unshift(report);
  if (reports.length > 100) reports.pop();
}

export function listReports(agentId?: string): UpgradeReport[] {
  return agentId ? reports.filter((r) => r.agentId === agentId) : reports;
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
