export type WithdrawalIntent = {
  amount: string;
  accountId: string;
  idempotencyKey: string;
};

export function parseWithdrawalIntent(
  value: string | null,
): WithdrawalIntent | null {
  if (!value) return null;
  try {
    const data = JSON.parse(value);
    if (
      typeof data.amount !== "string" ||
      !/^\d{1,16}(\.\d{1,2})?$/.test(data.amount) ||
      typeof data.accountId !== "string" ||
      !/^[a-f0-9-]{36}$/i.test(data.accountId) ||
      typeof data.idempotencyKey !== "string" ||
      !/^[a-zA-Z0-9-]{8,80}$/.test(data.idempotencyKey)
    )
      return null;
    return {
      amount: data.amount,
      accountId: data.accountId,
      idempotencyKey: data.idempotencyKey,
    };
  } catch {
    return null;
  }
}

export async function lookupWithdrawalIntent<T>(
  scope: "agent" | "admin",
  intent: WithdrawalIntent,
  signal?: AbortSignal,
): Promise<T | null> {
  const response = await fetch(
    `/api/${scope}/withdrawal-intents/${encodeURIComponent(intent.idempotencyKey)}`,
    {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    },
  );
  if (response.status === 404) return null;
  if (!response.ok)
    throw new Error("暂时无法确认上次申请结果，请稍后继续核对。");
  return response.json() as Promise<T>;
}
