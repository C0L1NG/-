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
    loading: false,
    recovering: false,
  },
  onShow() {
    syncPrivacy(this);
    this._visible = true;
    this._unloaded = false;
    const ready =
      typeof getApp === "function"
        ? getApp().ready || Promise.resolve()
        : Promise.resolve();
    return ready
      .then(() => {
        if (this._visible === false) return;
        const owner = wx.getStorageSync?.("agent_user_id");
        const key = owner ? `agent_withdrawal_intent:${owner}` : null;
        if (this.storageKey && this.storageKey !== key) {
          this.intent = null;
          this.setData({
            amount: "",
            accountId: "",
            accounts: [],
            items: [],
            wallet: null,
            recovering: false,
            busy: false,
            page: 1,
            total: 0,
          });
        }
        this.storageKey = key;
        const pending = this.storageKey
          ? wx.getStorageSync(this.storageKey)
          : null;
        if (pending && typeof pending.idempotencyKey === "string") {
          this.intent = pending;
          this.setData({
            amount: pending.amount,
            accountId: pending.accountId,
            recovering: true,
          });
        }
        this.load();
      })
      .catch((error) => {
        if (this._visible !== false) this.setData({ error: error.message });
      });
  },
  onHide() {
    this._visible = false;
    this._request = (this._request || 0) + 1;
  },
  onUnload() {
    this._unloaded = true;
    this.onHide();
  },
  load() {
    const sequence = (this._request = (this._request || 0) + 1);
    const page = this.data.page;
    this.setData({ loading: true });
    return Promise.all([
      request("/api/agent/payout-accounts"),
      request("/api/agent/wallet"),
      request(`/api/agent/withdrawals?page=${page}&pageSize=20`),
    ])
      .then(([a, w, r]) => {
        if (sequence !== this._request || this._visible === false) return;
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
        });
      })
      .catch((e) => {
        if (sequence === this._request && this._visible !== false)
          this.setData({ error: e.message });
      })
      .finally(() => {
        if (sequence === this._request && this._visible !== false)
          this.setData({ loading: false });
      });
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
    if (this.intent) return;
    this.setData({ amount: e.detail.value });
  },
  selectAccount(e) {
    if (this.intent) return;
    this.setData({ accountId: this.data.accounts[Number(e.detail.value)].id });
  },
  submit() {
    if (this.data.busy) return;
    if (!this.storageKey)
      return this.setData({ error: "请先完成微信登录，再申请提现。" });
    const storageKey = this.storageKey;
    const current = () => this.storageKey === storageKey && !this._unloaded;
    if (
      !/^\d{1,16}(\.\d{1,2})?$/.test(this.data.amount) ||
      !this.data.accountId
    )
      return this.setData({ error: "请输入金额并绑定本人收款账户" });
    const pending = this.intent || {
      amount: this.data.amount,
      accountId: this.data.accountId,
      idempotencyKey: `wx-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    };
    this.intent = pending;
    wx.setStorageSync(storageKey, pending);
    this.setData({ busy: true, error: "" });
    let submitted = false;
    const lookup = this.data.recovering
      ? request(
          `/api/agent/withdrawal-intents/${encodeURIComponent(pending.idempotencyKey)}`,
        ).catch((e) => {
          if (e.statusCode === 404) return null;
          throw e;
        })
      : Promise.resolve(null);
    return lookup
      .then((found) => {
        if (found) return found;
        submitted = true;
        return request("/api/agent/withdrawals", {
          method: "POST",
          data: pending,
        });
      })
      .then(() => {
        wx.removeStorageSync(storageKey);
        if (!current()) return;
        this.intent = null;
        this.setData({ amount: "", recovering: false });
        if (this._visible !== false) {
          wx.showToast({ title: "申请已提交" });
          return this.load();
        }
      })
      .catch((e) => {
        if (
          submitted &&
          e.statusCode >= 400 &&
          e.statusCode < 500 &&
          ![408, 429].includes(e.statusCode) &&
          e.data?.code !== "IDEMPOTENCY_CONFLICT"
        ) {
          wx.removeStorageSync(storageKey);
          if (!current()) return;
          this.intent = null;
          this.setData({ recovering: false, error: e.message });
        } else if (current())
          this.setData({
            recovering: true,
            error: "申请结果尚未确认，请核对上次结果，确认前不能新建申请。",
          });
      })
      .finally(() => {
        if (current()) this.setData({ busy: false });
      });
  },
  previous() {
    if (this.data.page <= 1) return;
    this.setData({ page: this.data.page - 1 });
    this.load();
  },
  next() {
    if (this.data.page * 20 >= this.data.total) return;
    this.setData({ page: this.data.page + 1 });
    this.load();
  },
});
