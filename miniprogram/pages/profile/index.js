const api = require("../../services/api");
Page({
  data: { referral: null, overview: null, error: "", loggedOut: false },
  onShow() {
    if (this.data.loggedOut) return;
    (getApp().ready || Promise.resolve())
      .then(() =>
        Promise.all([
          api.request("/api/agent/referral"),
          api.request("/api/agent/overview"),
        ]),
      )
      .then(([referral, overview]) =>
        this.setData({ referral, overview, error: "" }),
      )
      .catch((e) => this.setData({ error: e.message }));
  },
  copy() {
    if (!this.data.overview || !this.data.referral) return;
    if (this.data.overview.currentCommissionRatePercent === 49)
      return wx.showToast({ title: "二级伙伴不能继续招募代理", icon: "none" });
    wx.setClipboardData({ data: this.data.referral.referralUrl });
  },
  poster() {
    if (!this.data.overview || !this.data.referral) return;
    if (this.data.overview.currentCommissionRatePercent === 49)
      return wx.showToast({ title: "二级伙伴不能继续招募代理", icon: "none" });
    wx.navigateTo({ url: "/pages/referral/index" });
  },
  withdraw() {
    wx.navigateTo({ url: "/pages/withdrawals/index" });
  },
  webLogin() {
    api
      .request("/api/auth/web-ticket", { method: "POST" })
      .then((result) =>
        wx.setClipboardData({
          data: result.ticket,
          success: () =>
            wx.showModal({
              title: "网页登录码已复制",
              content:
                "在网站登录页选择微信网页登录并粘贴。仅能使用一次，60秒内有效。",
              showCancel: false,
            }),
        }),
      )
      .catch((e) => wx.showToast({ title: e.message, icon: "none" }));
  },
  logout() {
    api
      .logout()
      .then(() => {
        wx.showToast({ title: "已退出", icon: "none" });
      })
      .catch(() =>
        wx.showToast({ title: "已本地退出，会话撤销未确认", icon: "none" }),
      )
      .finally(() => {
        getApp().globalData.authenticated = false;
        this.setData({ loggedOut: true, overview: null, referral: null });
      });
  },
  login() {
    getApp()
      .authenticate()
      .then(() => {
        this.setData({ loggedOut: false });
        this.onShow();
      })
      .catch(() => {});
  },
});
