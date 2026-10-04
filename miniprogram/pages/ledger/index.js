const { syncPrivacy } = require("../../services/privacy");
const { pageLoader, reset } = require("../../services/pager");
Page({
  data: {
    hidden: true,
    items: [],
    month: "",
    role: "",
    page: 0,
    totalPages: 1,
    total: 0,
    loading: false,
    error: "",
  },
  onShow() {
    syncPrivacy(this);
  },
  onLoad() {
    const now = new Date();
    this.setData({
      month: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
    });
    this.reload();
  },
  onMonth(e) {
    this.setData({ month: e.detail.value });
    this.reload();
  },
  onFilter(e) {
    this.setData({ role: e.currentTarget.dataset.role });
    this.reload();
  },
  reload() {
    reset(this);
    return (getApp().ready || Promise.resolve())
      .then(() => this.loadMore())
      .catch((e) => this.setData({ error: e.message }));
  },
  loadMore() {
    const [y, m] = this.data.month.split("-").map(Number);
    const end = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    return pageLoader(
      this,
      (page) =>
        `/api/agent/activity?page=${page}&pageSize=50&from=${this.data.month}-01&to=${end}${this.data.role ? "&roleType=" + this.data.role : ""}`,
    );
  },
  onReachBottom() {
    this.loadMore();
  },
  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh());
  },
});
