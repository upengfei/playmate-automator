import { createFileRoute } from "@tanstack/react-router";
import { RELEASE } from "@/lib/agent-fleet.server";

/** 桌面 Agent 启动/定时拉取的版本清单（公开只读） */
export const Route = createFileRoute("/api/public/agent/version")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const platform = url.searchParams.get("platform") ?? "win";
        const origin = url.origin;
        const artifact =
          RELEASE.artifacts.find((a) => a.platform === platform) ?? RELEASE.artifacts[0]!;
        return Response.json({
          version: RELEASE.version,
          channel: RELEASE.channel,
          publishedAt: RELEASE.publishedAt,
          minSupported: RELEASE.minSupported,
          notes: RELEASE.notes,
          artifact: { ...artifact, url: `${origin}${artifact.url}` },
          artifacts: RELEASE.artifacts.map((a) => ({ ...a, url: `${origin}${a.url}` })),
        });
      },
    },
  },
});
