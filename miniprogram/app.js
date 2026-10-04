const api = require("./services/api");
function referralFrom(options = {}) {
  const query = options.query || {};
  let scene = "";
  try {
    scene = decodeURIComponent(query.scene || "");
  } catch (_) {
    return "";
  }
  return scene.startsWith("r=") ? scene.slice(2) : query.ref || "";
}
App({
  globalData: { pendingReferral: "", authenticated: false },
  onLaunch(options) {
    this.authenticate(referralFrom(options));
  },
  onShow(options) {
    if (this.globalData.loggedOut) return;
    const referral = referralFrom(options);
    if (referral && referral !== this.globalData.pendingReferral)
      this.authenticate(referral);
  },
  authenticate(referral = "") {
    this.globalData.loggedOut = false;
    this.globalData.pendingReferral = referral;
    // Login and initial referral binding commit in one server transaction.
    // A warm scan queues behind any current login instead of losing its referral.
    const authEpoch = api.beginLogin ? api.beginLogin() : 0;
    const valid = () => !api.isCurrent || api.isCurrent(authEpoch);
    const previous = this.ready || Promise.resolve();
    this.ready = previous
      .catch(() => {})
      .then(() => {
        if (!valid()) throw new Error("会话已退出，请重新登录");
        return api.login(referral);
      })
      .then((result) => {
        if (!valid()) throw new Error("会话已退出，请重新登录");
        this.globalData.authenticated = true;
        return result;
      });
    this.ready.catch((error) => {
      if (!valid()) return;
      this.globalData.authenticated = false;
      if (this.globalData.pendingReferral === referral)
        this.globalData.pendingReferral = "";
      wx.showToast({
        title: error.message || "登录或绑定失败，请重试",
        icon: "none",
      });
    });
    return this.ready;
  },
});
