const { request, logout } = require("../../services/api");
Page({
  data: { all: null, day: null, error: "", loading: true },
  onShow() {
    if (!wx.getStorageSync("admin_access_token")) return;
    this.load();
  },
  load() {
    this.setData({ loading: true, error: "" });
    return Promise.all([
      request("/api/admin/overview"),
      request("/api/admin/overview?period=day"),
    ])
      .then(([all, day]) => this.setData({ all, day }))
      .catch((e) => this.setData({ error: e.message }))
      .finally(() => this.setData({ loading: false }));
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
