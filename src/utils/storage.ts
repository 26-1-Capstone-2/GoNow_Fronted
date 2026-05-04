/**
 * 토큰·설정 저장용. 프로덕션에서는 expo-secure-store 등으로 교체 권장.
 */
const memory = new Map<string, string>();

export async function setItem(key: string, value: string): Promise<void> {
  memory.set(key, value);
}

export async function getItem(key: string): Promise<string | null> {
  return memory.get(key) ?? null;
}

export async function removeItem(key: string): Promise<void> {
  memory.delete(key);
}
