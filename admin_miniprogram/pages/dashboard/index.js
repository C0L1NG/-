const { request, logout } = require("../../services/api");
Page({
  data: { all: null, day: null, error: "", loading: true },
  onShow() {
    if (!wx.getStorageSync("admin_access_token")) return;
    this._visible = true;
    this.load();
  },
  onHide() {
    this._visible = false;
    this._request = (this._request || 0) + 1;
  },
  onUnload() {
    this.onHide();
  },
  load() {
    const sequence = (this._request = (this._request || 0) + 1);
    this.setData({ loading: true, error: "" });
    return Promise.allSettled([
      request("/api/admin/overview"),
      request("/api/admin/overview?period=day"),
    ]).then(([all, day]) => {
      if (sequence !== this._request || this._visible === false) return;
      const patch = { loading: false };
      if (all.status === "fulfilled") patch.all = all.value;
      if (day.status === "fulfilled") patch.day = day.value;
      patch.error =
        all.status === "rejected" || day.status === "rejected"
          ? "部分概览暂时无法更新，已保留上次数据"
          : "";
      this.setData(patch);
    });
  },
  web() {
    const { WEB_BASE_URL } = require("../../config");
    if (!WEB_BASE_URL)
      return wx.showToast({ title: "请先配置管理网站域名", icon: "none" });
    request("/api/auth/admin/web-ticket", { method: "POST" })
      .then((result) => {
        const url =
          WEB_BASE_URL +
          "/login/#ticket=" +
          encodeURIComponent(result.ticket) +
          "&next=%2Fadmin%2Fmobile%2F";
        wx.navigateTo({
          url: "/pages/web/index?url=" + encodeURIComponent(url),
        });
      })
      .catch((error) => this.setData({ error: error.message }));
  },
  logout() {
    logout()
      .catch(() => {})
      .finally(() => {
        wx.reLaunch({ url: "/pages/login/index" });
      });
  },
});
