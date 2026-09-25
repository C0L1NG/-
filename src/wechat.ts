import { randomBytes } from "node:crypto";

export type WechatSession = { openId: string; unionId?: string };
export interface WechatProvider {
  code2Session(code: string): Promise<WechatSession>;
  getUnlimitedCode(scene: string, page: string): Promise<{ bytes: Buffer; contentType: string }>;
}

type ErrorPayload = { errcode?: number; errmsg?: string };

export class WechatApiClient implements WechatProvider {
  private token: { value: string; expiresAt: number } | null = null;
  constructor(private readonly appId: string, private readonly appSecret: string) {}

  async code2Session(code: string): Promise<WechatSession> {
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.search = new URLSearchParams({ appid: this.appId, secret: this.appSecret,
      js_code: code, grant_type: "authorization_code" }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    const body = await response.json() as ErrorPayload & { openid?: string; unionid?: string };
    if (!response.ok || body.errcode || !body.openid) throw new Error(`WeChat login failed: ${body.errmsg ?? response.status}`);
    return { openId: body.openid, ...(body.unionid ? { unionId: body.unionid } : {}) };
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
    url.search = new URLSearchParams({ grant_type: "client_credential", appid: this.appId,
      secret: this.appSecret }).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    const body = await response.json() as ErrorPayload & { access_token?: string; expires_in?: number };
    if (!response.ok || body.errcode || !body.access_token) throw new Error(`WeChat token failed: ${body.errmsg ?? response.status}`);
    this.token = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 7200) * 1000 };
    return body.access_token;
  }

  async getUnlimitedCode(scene: string, page: string) {
    const token = await this.accessToken();
    const response = await fetch(`https://api.weixin.qq.com/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scene, page, width: 430, check_path: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const contentType = response.headers.get("content-type") ?? "application/octet-stream";
    if (!response.ok || contentType.includes("json")) {
      const body = await response.json() as ErrorPayload;
      throw new Error(`WeChat code generation failed: ${body.errmsg ?? response.status}`);
    }
    return { bytes: Buffer.from(await response.arrayBuffer()), contentType };
  }
}

export function newReferralCode(): string {
  return `AG${randomBytes(6).toString("hex").toUpperCase()}`;
}
