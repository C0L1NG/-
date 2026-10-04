const { request } = require("../../services/api");
Page({
  data: {
    items: [],
    page: 0,
    totalPages: 1,
    loading: false,
    error: "",
    open: "",
    children: [],
    childPage: 0,
    childTotalPages: 1,
    childLoading: false,
    childError: "",
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
      open: "",
    });
    this.load();
  },
  load() {
    if (this.data.loading || this.data.page >= this.data.totalPages) return;
    const version = this._rootVersion;
    this.setData({ loading: true, error: "" });
    request(
      `/api/admin/team-network?period=month&page=${this.data.page + 1}&pageSize=20`,
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
    const id = e.currentTarget.dataset.id;
    if (this.data.open === id) return this.setData({ open: "" });
    this._childVersion = (this._childVersion || 0) + 1;
    this.setData({
      open: id,
      children: [],
      childPage: 0,
      childTotalPages: 1,
      childLoading: false,
      childError: "",
    });
    this.children();
  },
  children() {
    if (
      this.data.childLoading ||
      this.data.childPage >= this.data.childTotalPages
    )
      return;
    const version = this._childVersion;
    this.setData({ childLoading: true, childError: "" });
    request(
      `/api/admin/team-network?period=month&parentId=${this.data.open}&page=${this.data.childPage + 1}&pageSize=20`,
    )
      .then((result) => {
        if (version === this._childVersion)
          this.setData({
            children: [...this.data.children, ...result.items],
            childPage: result.page,
            childTotalPages: result.totalPages,
          });
      })
      .catch((e) => {
        if (version === this._childVersion)
          this.setData({ childError: e.message });
      })
      .finally(() => {
        if (version === this._childVersion)
          this.setData({ childLoading: false });
      });
  },
});
