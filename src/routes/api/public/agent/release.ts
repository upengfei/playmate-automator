import { createFileRoute } from "@tanstack/react-router";

/**
 * CI 发布安装包后登记真实发布清单（版本号、说明、各平台安装包与校验值）。
 * 需要请求头 x-release-token 与平台密钥 AGENT_RELEASE_TOKEN 一致。
 */
export const Route = createFileRoute("/api/public/agent/release")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const secret = process.env["AGENT_RELEASE_TOKEN"];
        const provided = request.headers.get("x-release-token") ?? "";
        if (!secret || provided !== secret) {
          return Response.json({ error: "发布令牌校验失败" }, { status: 401 });
        }
        const { manifestSchema, publishRelease } = await import("@/lib/agent-fleet.server");
        const parsed = manifestSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return Response.json({ error: "参数不合法" }, { status: 400 });
        const res = await publishRelease(parsed.data);
        if (!res.ok) return Response.json({ error: res.message }, { status: 500 });
        return Response.json({ ok: true, version: parsed.data.version });
      },
    },
  },
});
