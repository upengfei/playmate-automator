import { createFileRoute } from "@tanstack/react-router";
import { RELEASE, artifactUrl } from "@/lib/agent-fleet.server";

/** 桌面 Agent 启动/定时拉取的版本清单（公开只读） */
export const Route = createFileRoute("/api/public/agent/version")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const platform = url.searchParams.get("platform") ?? "win";
        const origin = url.origin;
        // 在请求时计算下载地址：配置了 AGENT_DOWNLOAD_BASE（如 GitHub Release）
        // 时直接返回公开绝对地址，否则拼接站点内 /downloads/ 路径。
        const withUrl = <T extends { file: string; url: string }>(a: T) => {
          const u = artifactUrl(a.file);
          return { ...a, url: u.startsWith("http") ? u : `${origin}${u}` };
        };
        const artifacts = RELEASE.artifacts.map(withUrl);
        const artifact = artifacts.find((a) => a.platform === platform) ?? artifacts[0]!;
        return Response.json({
          version: RELEASE.version,
          channel: RELEASE.channel,
          publishedAt: RELEASE.publishedAt,
          minSupported: RELEASE.minSupported,
          notes: RELEASE.notes,
          artifact,
          artifacts,
        });
      },
    },
  },
});
