const { request } = require("../../services/api");
Page({
  data: {
    items: [],
    page: 0,
    totalPages: 1,
    loading: false,
    error: "",
    open: "",
  },
  onShow() {
    if (!wx.getStorageSync("admin_access_token")) return;
    this._rootVersion = (this._rootVersion || 0) + 1;
    this._childVersion = (this._childVersion || 0) + 1;
    this.setData({
      loading: false,
      childLoading: false,
      children: [],
      items: [],
      page: 0,
      totalPages: 1,
    });
    this.load();
  },
  load() {
    if (this.data.loading || this.data.page >= this.data.totalPages) return;
    const version = this._rootVersion;
    this.setData({ loading: true, error: "" });
    request(
      `/api/admin/commission-audit?page=${this.data.page + 1}&pageSize=20`,
    )
      .then((result) => {
        if (version !== this._rootVersion) return;
        this.setData({
          items: Array.from(
            new Map(
              [...this.data.items, ...result.items].map((item) => [
                item.id,
                item,
              ]),
            ).values(),
          ),
          page: result.page,
          totalPages: result.totalPages,
        });
      })
      .catch((e) => {
        if (version === this._rootVersion) this.setData({ error: e.message });
      })
      .finally(() => {
        if (version === this._rootVersion) this.setData({ loading: false });
      });
  },
  onReachBottom() {
    this.load();
  },
  toggle(e) {
    this.setData({
      open:
        this.data.open === e.currentTarget.dataset.id
          ? ""
          : e.currentTarget.dataset.id,
    });
  },
});
