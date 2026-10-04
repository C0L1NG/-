const { syncPrivacy } = require("../../services/privacy");
const { request } = require("../../services/api");
Page({
  data: {
    hidden: true,
    accounts: [],
    items: [],
    wallet: null,
    amount: "",
    accountId: "",
    busy: false,
    error: "",
    page: 1,
    total: 0,
  },
  onShow() {
    syncPrivacy(this);
    this.load();
  },
  load() {
    return Promise.all([
      request("/api/agent/payout-accounts"),
      request("/api/agent/wallet"),
      request(`/api/agent/withdrawals?page=${this.data.page}&pageSize=20`),
    ])
      .then(([a, w, r]) =>
        this.setData({
          accounts: a.items.filter((x) => x.verified),
          accountId:
            this.data.accountId ||
            (a.items.find((x) => x.verified) || {}).id ||
            "",
          wallet: w,
          items: r.items,
          total: r.total,
          error: "",
        }),
      )
      .catch((e) => this.setData({ error: e.message }));
  },
  bindWechat() {
    request("/api/agent/payout-accounts", {
      method: "POST",
      data: { provider: "wechat" },
    })
      .then(() => this.load())
      .catch((e) => this.setData({ error: e.message }));
  },
  onAmount(e) {
    this.setData({ amount: e.detail.value });
  },
  selectAccount(e) {
    this.setData({ accountId: this.data.accounts[Number(e.detail.value)].id });
  },
  submit() {
    if (this.data.busy) return;
    if (
      !/^\d{1,16}(\.\d{1,2})?$/.test(this.data.amount) ||
      !this.data.accountId
    )
      return this.setData({ error: "请输入金额并绑定本人收款账户" });
    this.key =
      this.key || `wx-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.setData({ busy: true, error: "" });
    return request("/api/agent/withdrawals", {
      method: "POST",
      data: {
        amount: this.data.amount,
        accountId: this.data.accountId,
        idempotencyKey: this.key,
      },
    })
      .then(() => {
        this.key = null;
        this.setData({ amount: "" });
        wx.showToast({ title: "申请已提交" });
        return this.load();
      })
      .catch((e) => this.setData({ error: e.message }))
      .finally(() => this.setData({ busy: false }));
  },
  previous() {
    this.setData({ page: this.data.page - 1 });
    this.load();
  },
  next() {
    this.setData({ page: this.data.page + 1 });
    this.load();
  },
});
