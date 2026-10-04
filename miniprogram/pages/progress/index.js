const { syncPrivacy } = require("../../services/privacy");
const { request } = require("../../services/api");
Page({
  data: {
    hidden: true,
    summary: null,
    loading: true,
    error: "",
    share: 0,
    hasMix: false,
  },
  onShow() {
    syncPrivacy(this);
    (getApp().ready || Promise.resolve())
      .then(() => this.load())
      .catch((e) => this.setData({ loading: false, error: e.message }));
  },
  load() {
    this.setData({ loading: true, error: "" });
    return request("/api/agent/progress")
      .then((summary) =>
        this.setData({
          summary,
          hasMix:
            Number(summary.monthEarned) > 0 &&
            Number(summary.ownEarnings) >= 0 &&
            Number(summary.teamEarnings) >= 0,
          share:
            Number(summary.monthEarned) > 0 &&
            Number(summary.ownEarnings) >= 0 &&
            Number(summary.teamEarnings) >= 0
              ? Math.max(
                  0,
                  Math.min(
                    100,
                    Math.round(
                      (Number(summary.ownEarnings) /
                        Number(summary.monthEarned)) *
                        100,
                    ),
                  ),
                )
              : 0,
        }),
      )
      .catch((e) => this.setData({ error: e.message }))
      .finally(() => this.setData({ loading: false }));
  },
  openTeam() {
    wx.navigateTo({ url: "/pages/team/index" });
  },
});
