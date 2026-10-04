const { syncPrivacy } = require("../../services/privacy");
const { pageLoader, reset } = require("../../services/pager");
Page({
  data: {
    hidden: true,
    items: [],
    page: 0,
    totalPages: 1,
    total: 0,
    loading: false,
    error: "",
  },
  onShow() {
    syncPrivacy(this);
    this.reload();
  },
  reload() {
    reset(this);
    return (getApp().ready || Promise.resolve())
      .then(() => this.loadMore())
      .catch((e) => this.setData({ error: e.message }));
  },
  loadMore() {
    return pageLoader(
      this,
      (page) => `/api/agent/team?page=${page}&pageSize=50`,
    );
  },
  onReachBottom() {
    this.loadMore();
  },
  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh());
  },
});
