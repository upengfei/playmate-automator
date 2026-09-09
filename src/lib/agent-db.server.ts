/** 真实节点与执行数据的服务端访问（仅服务端，数据保存在本地 SQLite） */
import { localClient } from "./local-db.server";
import { readAgentToken } from "./agent-store.server";

export function admin() {
  return localClient();
}


/** 校验节点令牌（令牌存放于本地 SQLite）；true 表示请求确实来自已注册的客户端 */
export async function verifyAgent(agentId: string, token: string): Promise<boolean> {
  if (!agentId || !token) return false;
  const saved = await readAgentToken(agentId);
  return Boolean(saved && saved === token);
}

export function newToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}
