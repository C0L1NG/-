const { syncPrivacy, togglePrivacy } = require("../../services/privacy");
const { request } = require("../../services/api");
Page({
  data: {
    loading: true,
    error: "",
    activityError: "",
    overview: null,
    items: [],
    hidden: true,
    updatedAt: "",
  },
  onShow() {
    syncPrivacy(this);
    this._visible = true;
    (getApp().ready || Promise.resolve())
      .then(() => this.load())
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  onHide() {
    this._visible = false;
    this._request = (this._request || 0) + 1;
  },
  onUnload() {
    this.onHide();
  },
  load() {
    if (this._visible === false) return Promise.resolve();
    const sequence = (this._request = (this._request || 0) + 1);
    this.setData({ loading: true, error: "" });
    return Promise.allSettled([
      request("/api/agent/overview"),
      request("/api/agent/activity?page=1&pageSize=2"),
    ]).then(([account, activity]) => {
      if (sequence !== this._request || this._visible === false) return;
      const patch = { loading: false, activityError: "" },
        errors = [];
      this.authFailure = [account, activity].some(
        (result) =>
          result.status === "rejected" &&
          [401, 403].includes(result.reason.statusCode),
      );
      if (account.status === "fulfilled") {
        patch.overview = account.value;
        patch.updatedAt = new Date().toISOString().slice(11, 19) + " UTC";
      } else errors.push("账户概览暂时无法更新");
      if (activity.status === "fulfilled")
        patch.items = activity.value.items.map((item) => ({
          ...item,
          displayAmount: String(item.commissionAmount).replace(/^-/, ""),
        }));
      else {
        patch.activityError = "流水暂时无法更新";
        errors.push(patch.activityError);
      }
      patch.error = errors.join("；");
      this.setData(patch);
    });
  },
  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh());
  },
  retry() {
    return this.authFailure
      ? getApp()
          .authenticate()
          .then(() => this.load())
          .catch(() => {})
      : this.load();
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
