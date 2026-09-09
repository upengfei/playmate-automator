import { createFileRoute } from "@tanstack/react-router";

/** Playwright 浏览器内核上游下载源，平台侧代理转发，客户端只需下载一次 */
const UPSTREAM = "https://cdn.playwright.dev/dbazure/download/playwright";

/** 平台侧浏览器内核镜像：把客户端的下载请求转发到上游 CDN 并流式回传 */
export const Route = createFileRoute("/api/public/browser-mirror/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const rest = url.pathname.replace(/^\/api\/public\/browser-mirror\/?/, "");
        if (!rest || rest.includes("..")) {
          return new Response("路径不合法", { status: 400 });
        }
        const range = request.headers.get("range");
        const upstream = await fetch(`${UPSTREAM}/${rest}`, {
          headers: range ? { range } : {},
        });
        if (!upstream.ok && upstream.status !== 206) {
          return new Response(`浏览器内核下载失败：HTTP ${upstream.status}`, {
            status: upstream.status,
          });
        }
        const headers = new Headers();
        for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) {
          const v = upstream.headers.get(key);
          if (v) headers.set(key, v);
        }
        headers.set("cache-control", "public, max-age=31536000, immutable");
        return new Response(upstream.body, { status: upstream.status, headers });
      },
    },
  },
});
