import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { LogIn, ShieldCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/use-auth";
import { ThemeToggle } from "@/components/theme-toggle";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "登录 PlayFlow 自动化测试平台" },
      {
        name: "description",
        content: "使用邮箱与密码登录 PlayFlow，管理 Playwright 用例、下发执行任务并查看测试报告。",
      },
      { property: "og:title", content: "登录 PlayFlow 自动化测试平台" },
      {
        property: "og:description",
        content: "邮箱密码登录，进入用例管理、任务下发与测试报告分析。",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!loading && session) navigate({ to: "/" });
  }, [loading, session, navigate]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        navigate({ to: "/" });
      } else {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        if (data.session) navigate({ to: "/" });
        else setMsg("注册成功，请到邮箱点击确认链接后再登录。");
      }
    } catch (e) {
      const raw = (e as Error).message || "操作失败";
      setErr(
        raw.includes("Invalid login credentials")
          ? "邮箱或密码不正确"
          : raw.includes("already registered")
            ? "该邮箱已注册，请直接登录"
            : raw,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-background text-foreground flex min-h-screen items-center justify-center p-6">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <div className="bg-card w-full max-w-sm rounded-2xl border p-7 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <div className="bg-primary text-primary-foreground grid size-10 place-items-center rounded-xl font-bold">
            P
          </div>
          <div className="leading-tight">
            <h1 className="text-base font-semibold">PlayFlow 自动化测试平台</h1>
            <p className="text-muted-foreground text-xs">Playwright 用例管理与任务下发</p>
          </div>
        </div>

        <div className="bg-muted mb-5 grid grid-cols-2 gap-1 rounded-lg p-1 text-sm">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setErr("");
                setMsg("");
              }}
              className={
                mode === m
                  ? "bg-card text-foreground rounded-md py-1.5 font-medium shadow-sm"
                  : "text-muted-foreground rounded-md py-1.5"
              }
            >
              {m === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">邮箱</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none"
              placeholder="you@company.com"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-sm font-medium">密码</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-background focus:border-primary w-full rounded-lg border px-3 py-2 text-sm outline-none"
              placeholder="至少 6 位"
            />
          </label>

          {err && <p className="text-destructive text-sm">{err}</p>}
          {msg && <p className="text-success text-sm">{msg}</p>}

          <button
            type="submit"
            disabled={busy}
            className="bg-primary text-primary-foreground flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium disabled:opacity-60"
          >
            <LogIn className="size-4" />
            {busy ? "处理中…" : mode === "login" ? "登录" : "注册并登录"}
          </button>
        </form>

        <p className="text-muted-foreground mt-5 flex items-center gap-1.5 text-xs">
          <ShieldCheck className="size-3.5" />
          仅支持邮箱密码登录，客户端节点仍使用节点令牌鉴权
        </p>
      </div>
    </div>
  );
}
