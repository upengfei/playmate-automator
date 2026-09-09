import { createFileRoute } from "@tanstack/react-router";

/** 桌面 Agent 启动/定时拉取的版本清单（真实发布记录，公开只读） */
export const Route = createFileRoute("/api/public/agent/version")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const platform = url.searchParams.get("platform") ?? "win";
        const origin = url.origin;
        const { readRelease } = await import("@/lib/agent-fleet.server");
        const release = await readRelease();
        // 相对地址补成当前站点绝对地址；已配置公开下载前缀时直接返回绝对地址
        const artifacts = release.artifacts.map((a) => ({
          ...a,
          url: a.url.startsWith("http") ? a.url : `${origin}${a.url}`,
        }));
        const artifact = artifacts.find((a) => a.platform === platform) ?? artifacts[0] ?? null;
        return Response.json({
          version: release.version,
          channel: release.channel,
          publishedAt: release.publishedAt,
          minSupported: release.minSupported,
          notes: release.notes,
          artifact,
          artifacts,
        });
      },
    },
  },
});
