import { apiClient } from "./client";

const UID_KEY = "langlisten_uid";
const USERNAME_KEY = "langlisten_username";

export interface UserIdentity {
  user_id: string;
  username: string;
}

/**
 * 应用启动时调用一次。
 * - 首次：后端生成 user_id + username，存入 localStorage
 * - 后续：传已有 user_id，后端幂等返回，顺便刷新 username 缓存
 */
export async function initIdentity(): Promise<UserIdentity> {
  const storedUid = localStorage.getItem(UID_KEY);

  const res = await apiClient.post<UserIdentity>("/api/web/users/init", {
    user_id: storedUid ?? null,
  });

  const { user_id, username } = res.data;
  localStorage.setItem(UID_KEY, user_id);
  localStorage.setItem(USERNAME_KEY, username);
  return { user_id, username };
}

/** 同步读取，已初始化后使用 */
export function getStoredUserId(): string | null {
  return localStorage.getItem(UID_KEY);
}

export function getStoredUsername(): string | null {
  return localStorage.getItem(USERNAME_KEY);
}