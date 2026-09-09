import { createFileRoute } from "@tanstack/react-router";

/** 读取某次 AI 元素抓取保存的页面截图（登录后可访问，不放在 api/public 下） */
export const Route = createFileRoute("/api/inspect-shot/$id")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { localClient } = await import("@/lib/local-db.server");
        const { data } = await localClient()
          .from("agent_inspects")
          .select("*")
          .eq("id", params.id)
          .maybeSingle();
        const shot = (data as Record<string, any> | null)?.["screenshot"] as string | undefined;
        if (!shot) return new Response("截图不存在", { status: 404 });
        const bytes = Uint8Array.from(atob(shot), (c) => c.charCodeAt(0));
        return new Response(bytes, {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "private, max-age=600",
          },
        });
      },
    },
  },
});
