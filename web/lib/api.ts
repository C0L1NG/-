export class AgentApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AgentApiError";
  }
}

export async function agentGet<T>(
  path: string,
  signal: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined")
      window.location.replace("/login/");
    throw new AgentApiError(
      response.status,
      `Agent API returned ${response.status}`,
    );
  }
  return response.json() as Promise<T>;
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  const messages: Record<string, string> = {
    INSUFFICIENT_BALANCE: "可用余额不足，或仍有退款待处理。",
    REFUND_REVIEW_REQUIRED: "有退款正在核对，请等待核对完成后继续操作。",
    REFUND_DEBT_BLOCKS_PAYOUT: "账户存在退款待追偿，请先核对。",
    VERIFIED_PAYOUT_ACCOUNT_REQUIRED: "请选择当前已核验的收款账户。",
    IDEMPOTENCY_CONFLICT: "申请内容与原记录不一致，请先核对原申请结果。",
    WITHDRAWAL_CLAIMED_BY_ANOTHER_ADMIN:
      "此笔提现已由其他管理员处理，请刷新记录。",
    PAYOUT_REFERENCE_CONFLICT: "付款凭据与已有记录不一致，请核对。",
    SESSION_REVOKED: "登录状态已失效，请重新登录。",
  };
  if (!response.ok)
    throw new AgentApiError(
      response.status,
      messages[data.code] || data.message || "请求未能完成，请稍后重试。",
      data.code,
    );
  return data as T;
}
