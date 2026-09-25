export class AgentApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "AgentApiError";
  }
}

export async function agentGet<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) {
    throw new AgentApiError(response.status, `Agent API returned ${response.status}`);
  }
  return response.json() as Promise<T>;
}
