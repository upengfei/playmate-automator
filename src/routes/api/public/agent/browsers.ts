import { createFileRoute } from "@tanstack/react-router";

/**
 * 浏览器内核下载配置：安装包内不再打包浏览器内核（避免体积超限），
 * 客户端首次运行时通过平台侧镜像地址下载一次并缓存到本地。
 */
export const Route = createFileRoute("/api/public/agent/browsers")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const origin = new URL(request.url).origin;
        return Response.json({
          // Playwright 官方安装器支持该地址作为下载源，这里指向平台侧镜像
          downloadHost: `${origin}/api/public/browser-mirror`,
          browsers: ["chromium", "firefox", "webkit"],
          // 客户端只需要下载一次，之后按此标记跳过
          cacheKey: "playwright-1.56.0",
          notes: "安装包不含浏览器内核，首次执行或录制时由平台镜像下载并永久缓存",
        });
      },
    },
  },
});
