"use client";

import { ArrowRight, Banknote, Check, Copy, CreditCard, LogOut, Moon, QrCode, Share2, ShieldCheck, Sun, Wallet } from "lucide-react";
import { useState } from "react";
import { agentGet } from "@/lib/api";
import type { MiniProgramCode } from "@/lib/types";
import { useAgent } from "./agent-context";
import { PageHeading, Sheet, panel } from "./agent-ui";

type Dialog = "poster" | "bank" | "wechat" | "logout" | null;

export function AgentProfile() {
  const { demo, overview, referral, theme, setTheme, notify } = useAgent();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [code, setCode] = useState<MiniProgramCode | null>(null);
  const [codeLoading, setCodeLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  async function copyInvite() {
    if (!referral?.referralUrl) return notify("邀请链接正在加载");
    try { await navigator.clipboard.writeText(referral.referralUrl); notify("专属邀请链接已复制"); }
    catch { notify("复制失败，请长按链接手动复制"); }
  }
  async function shareInvite() {
    if (!referral?.referralUrl) return notify("邀请链接正在加载");
    if (navigator.share) {
      try { await navigator.share({ title: "加入我的团队", text: "通过我的专属邀请链接加入", url: referral.referralUrl }); return; }
      catch { /* Share sheet was closed. */ }
    }
    await copyInvite();
  }
  async function openPoster() {
    setDialog("poster");
    if (demo || code) return;
    const controller = new AbortController();
    setCodeLoading(true);
    try { setCode(await agentGet<MiniProgramCode>("/api/agent/mini-program-code", controller.signal)); }
    catch { notify("太阳码暂时无法生成，请稍后重试"); }
    finally { setCodeLoading(false); }
  }
  async function logout() {
    if (demo) { setDialog(null); notify("演示模式无需退出登录"); return; }
    setLoggingOut(true);
    try {
      const response = await fetch("/api/agent/logout", { method: "POST", credentials: "same-origin" });
      if (!response.ok) throw new Error("logout failed");
      window.location.replace("/agent/");
    } catch { setLoggingOut(false); notify("退出失败，请重试"); }
  }

  return <>
    <PageHeading eyebrow="Your account / 04" title="我的" subtitle="管理你的专属推广、收款方式与账户偏好。" />
    <div className={panel + " flex items-center gap-4 p-5"}><span className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border border-white/[0.1] bg-[#28421F] text-[15px] font-extrabold text-[#9FE870]">{overview?.avatarUrl ? <img src={overview.avatarUrl} alt="" className="h-full w-full object-cover" /> : (overview?.displayName || "代理").slice(0, 2)}</span><span className="min-w-0 flex-1"><span className="block truncate text-[17px] font-extrabold">{overview?.displayName || "代理伙伴"}</span><span className="mt-1 block text-[11px] text-[var(--agent-muted)]">{overview?.currentCommissionRatePercent === 49 ? "Lv.2 认证合伙人" : "Lv.1 认证合伙人"}</span></span><ShieldCheck size={21} strokeWidth={1.5} className="text-[#9FE870]" /></div>

    <section id="invite" className="mt-7 scroll-mt-7 rounded-[30px] border border-[var(--agent-line)] bg-gradient-to-br from-[var(--agent-hero-from)] to-[var(--agent-hero-to)] p-6"><div className="flex items-center justify-between"><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#9FE870]">Your invitation</p><span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.06] text-[#9FE870]"><QrCode size={18} /></span></div><h2 className="mt-5 text-[23px] font-extrabold leading-tight tracking-[-0.05em]">专属获客与推广</h2><p className="mt-2 text-[11px] leading-5 text-[var(--agent-muted)]">分享你的邀请，只发展直属伙伴。分润严格限制为两级。</p><div className="mt-6 rounded-2xl border border-[var(--agent-line)] bg-black/10 px-4 py-3.5"><p className="text-[10px] text-[var(--agent-muted)]">我的专属邀请码</p><p className="mt-1.5 font-mono text-[18px] font-bold tracking-[0.08em] text-[#9FE870]">{referral?.referralCode ?? "加载中…"}</p></div><p className="mt-3 truncate font-mono text-[10px] text-[var(--agent-muted)]">{referral?.referralUrl ?? "正在获取专属邀请链接"}</p><div className="mt-6 grid grid-cols-2 gap-2.5"><button type="button" onClick={copyInvite} disabled={!referral} className="flex h-11 items-center justify-center gap-1.5 rounded-full bg-[#9FE870] text-[11px] font-extrabold text-[#0A1408] disabled:opacity-50"><Copy size={14} />复制链接</button><button type="button" onClick={shareInvite} disabled={!referral} className="flex h-11 items-center justify-center gap-1.5 rounded-full border border-[var(--agent-line)] bg-white/[0.06] text-[11px] font-bold text-[var(--agent-text)] disabled:opacity-50"><Share2 size={14} />分享邀请</button></div><button type="button" onClick={openPoster} className="mt-2.5 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--agent-line)] text-[11px] font-bold text-[var(--agent-text)]"><QrCode size={15} />生成微信太阳码海报 <ArrowRight size={14} /></button></section>

    <section className="mt-9"><h2 className="mb-3 text-[16px] font-extrabold tracking-[-0.04em]">收款方式</h2><div className={panel + " overflow-hidden"}><button type="button" onClick={() => setDialog("bank")} className="flex w-full items-center gap-3 px-5 py-4 text-left"><span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.05] bg-white/[0.06] text-[var(--agent-muted)]"><CreditCard size={17} /></span><span className="flex-1 text-[12px] font-semibold">提现银行卡绑定</span><span className="text-[10px] text-[var(--agent-muted)]">待接入</span><ArrowRight size={14} className="text-[var(--agent-muted)]" /></button><button type="button" onClick={() => setDialog("wechat")} className="flex w-full items-center gap-3 border-t border-[var(--agent-line)] px-5 py-4 text-left"><span className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.05] bg-white/[0.06] text-[var(--agent-muted)]"><Wallet size={17} /></span><span className="flex-1 text-[12px] font-semibold">微信零钱绑定</span><span className="text-[10px] text-[var(--agent-muted)]">待接入</span><ArrowRight size={14} className="text-[var(--agent-muted)]" /></button></div></section>

    <section className="mt-9"><h2 className="mb-3 text-[16px] font-extrabold tracking-[-0.04em]">偏好与安全</h2><div className={panel + " p-5"}><div className="flex items-center gap-2 text-[12px] font-semibold"><Moon size={17} className="text-[#9FE870]" />系统主题</div><div role="group" aria-label="选择系统主题" className="mt-4 grid grid-cols-2 gap-2 rounded-full bg-[var(--agent-soft)] p-1"><button type="button" onClick={() => setTheme("dark")} aria-pressed={theme === "dark"} className={"flex h-9 items-center justify-center gap-1.5 rounded-full text-[11px] font-bold " + (theme === "dark" ? "bg-[#9FE870] text-[#0A1408]" : "text-[var(--agent-muted)]")}><Moon size={13} />深色 {theme === "dark" && <Check size={12} />}</button><button type="button" onClick={() => setTheme("light")} aria-pressed={theme === "light"} className={"flex h-9 items-center justify-center gap-1.5 rounded-full text-[11px] font-bold " + (theme === "light" ? "bg-[#9FE870] text-[#0A1408]" : "text-[var(--agent-muted)]")}><Sun size={13} />浅色 {theme === "light" && <Check size={12} />}</button></div></div><button type="button" onClick={() => setDialog("logout")} className={panel + " mt-2.5 flex w-full items-center gap-3 px-5 py-4 text-left text-[12px] font-semibold"}><LogOut size={17} strokeWidth={1.7} className="text-[var(--agent-muted)]" />安全退出登录 <ArrowRight size={14} className="ml-auto text-[var(--agent-muted)]" /></button></section>
    <p className="mt-10 text-center text-[10px] text-[var(--agent-muted)]">平台统一结算 · 仅查看本人及直属团队</p>

    {dialog === "poster" && <Sheet title="微信太阳码海报" onClose={() => setDialog(null)}><div className="rounded-[25px] border border-[var(--agent-line)] bg-[var(--agent-surface)] p-6 text-center"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9FE870]">Invite your circle</p><h3 className="mt-3 text-[22px] font-extrabold">一起，让好收益发生。</h3><div className="mx-auto mt-6 flex h-44 w-44 items-center justify-center overflow-hidden rounded-3xl bg-white p-3">{code?.imageDataUrl ? <img src={code.imageDataUrl} alt="微信小程序太阳码" className="h-full w-full object-contain" /> : <div className="flex flex-col items-center gap-2 text-[#57704B]"><QrCode size={54} strokeWidth={1.2} /><span className="text-[10px] font-semibold">{codeLoading ? "正在生成…" : demo ? "演示模式无真实太阳码" : "暂时无法生成"}</span></div>}</div><p className="mt-5 font-mono text-[13px] font-bold tracking-wider text-[var(--agent-accent-text)]">{referral?.referralCode ?? "—"}</p><p className="mt-2 text-[10px] text-[var(--agent-muted)]">{demo ? "公开演示不可用于扫码绑定" : "扫码进入小程序并绑定直属关系"}</p></div>{code?.imageDataUrl && <a href={code.imageDataUrl} download="agent-wechat-code.png" className="mt-4 flex h-12 items-center justify-center rounded-full bg-[#9FE870] text-[12px] font-extrabold text-[#0A1408]">保存太阳码</a>}</Sheet>}
    {(dialog === "bank" || dialog === "wechat") && <Sheet title={dialog === "bank" ? "提现银行卡" : "微信零钱"} onClose={() => setDialog(null)}><div className={panel + " p-5 text-[12px] leading-6 text-[var(--agent-muted)]"}><Banknote size={22} className="mb-4 text-[#9FE870]" />收款方式绑定服务尚未接入，当前无法提交账户信息。正式开通后可在这里安全绑定。</div></Sheet>}
    {dialog === "logout" && <Sheet title="确认退出登录" onClose={() => setDialog(null)}><p className="text-[12px] leading-6 text-[var(--agent-muted)]">退出后需要重新通过微信授权登录才能查看账户数据。</p><button type="button" onClick={logout} disabled={loggingOut} className="mt-5 h-12 w-full rounded-full bg-[#9FE870] text-[12px] font-extrabold text-[#0A1408] disabled:opacity-60">{loggingOut ? "正在退出…" : "确认退出"}</button></Sheet>}
  </>;
}
