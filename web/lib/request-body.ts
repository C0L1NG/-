export class RequestBodyError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
  ) {
    super(code);
  }
}

export async function readLimitedBody(
  request: Pick<Request, "headers" | "body">,
  limit = 8192,
): Promise<string> {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > limit) {
    await request.body?.cancel();
    throw new RequestBodyError(413, "PAYLOAD_TOO_LARGE");
  }
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new RequestBodyError(413, "PAYLOAD_TOO_LARGE");
      }
      body += decoder.decode(value, { stream: true });
    }
    return body + decoder.decode();
  } catch (error) {
    if (error instanceof RequestBodyError) throw error;
    await reader.cancel().catch(() => {});
    throw new RequestBodyError(400, "INVALID_REQUEST_BODY");
  } finally {
    reader.releaseLock();
  }
}
