/** 真实节点与用例的服务端数据访问（仅服务端，使用服务角色密钥） */
import { createClient } from "@supabase/supabase-js";

export function admin() {
  return createClient(process.env["SUPABASE_URL"]!, process.env["SUPABASE_SERVICE_ROLE_KEY"]!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** 校验节点令牌；返回 true 表示该请求确实来自已注册的客户端 */
export async function verifyAgent(agentId: string, token: string): Promise<boolean> {
  if (!agentId || !token) return false;
  const db = admin();
  const { data } = await db.from("agent_tokens").select("token").eq("agent_id", agentId).maybeSingle();
  return Boolean(data && data.token === token);
}

export function newToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}
