const { syncPrivacy, togglePrivacy } = require("../../services/privacy");
const { request } = require("../../services/api");
Page({
  data: { loading: true, error: "", overview: null, items: [], hidden: true },
  onShow() {
    syncPrivacy(this);
    (getApp().ready || Promise.resolve())
      .then(() => this.load())
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  load() {
    this.setData({ loading: true, error: "" });
    return Promise.all([
      request("/api/agent/overview"),
      request("/api/agent/activity?page=1&pageSize=2"),
    ])
      .then(([overview, ledger]) =>
        this.setData({
          overview,
          items: ledger.items.map((item) => ({
            ...item,
            displayAmount: String(item.commissionAmount).replace(/^-/, ""),
          })),
        }),
      )
      .catch((e) => this.setData({ error: e.message || "账户数据暂时不可用" }))
      .finally(() => this.setData({ loading: false }));
  },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },
  retry() {
    getApp()
      .authenticate()
      .then(() => this.load())
      .catch(() => {});
  },
  toggleBalance() {
    togglePrivacy(this);
  },
  openSettlement() {
    wx.navigateTo({ url: "/pages/withdrawals/index" });
  },
  openPoster() {
    wx.switchTab({ url: "/pages/profile/index" });
  },
  openLedger() {
    wx.switchTab({ url: "/pages/ledger/index" });
  },
});
