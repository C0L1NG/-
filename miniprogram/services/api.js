const { API_BASE_URL } = require("../config");
const messages = {
  INSUFFICIENT_BALANCE: "可用余额不足，或仍有退款待处理。",
  REFUND_REVIEW_REQUIRED: "有退款正在核对，请等待核对完成后继续操作。",
  VERIFIED_PAYOUT_ACCOUNT_REQUIRED: "请选择当前已核验的收款账户。",
  IDEMPOTENCY_CONFLICT: "申请内容与原记录不一致，请先核对原申请结果。",
  SESSION_REVOKED: "登录状态已失效，请重新登录。",
};
let loginFlight = null;
let epoch = 0;
let stopped = false;
const cancelled = () =>
  Object.assign(new Error("会话已退出，请重新登录"), {
    code: "SESSION_CANCELLED",
  });
function current(value) {
  return value === epoch && !stopped;
}
let loginReferral = "";

function send(path, options = {}) {
  return new Promise((resolve, reject) =>
    wx.request({
      url: `${API_BASE_URL}${path}`,
      method: options.method || "GET",
      timeout: 15000,
      data: options.data,
      header: {
        Authorization: `Bearer ${options.token ?? (wx.getStorageSync("agent_access_token") || "")}`,
        "Content-Type": "application/json",
      },
      success: ({ statusCode, data }) =>
        statusCode >= 200 && statusCode < 300
          ? resolve(data)
          : reject(
              Object.assign(
                new Error(
                  messages[data.code] ||
                    data.message ||
                    "请求未能完成，请稍后重试。",
                ),
                { statusCode, data },
              ),
            ),
      fail: reject,
    }),
  );
}
function login(referralCode, renew = false) {
  if (renew && stopped) return Promise.reject(cancelled());
  stopped = false;
  const attemptEpoch = epoch;
  if (loginFlight) {
    if (referralCode && referralCode !== loginReferral)
      return loginFlight.then(() => {
        if (!current(attemptEpoch)) throw cancelled();
        return login(referralCode);
      });
    return loginFlight;
  }
  loginReferral = referralCode || "";
  const flight = new Promise((resolve, reject) =>
    wx.login({
      success: ({ code }) => {
        if (!current(attemptEpoch)) return reject(cancelled());
        if (!code) return reject(new Error("微信登录失败"));
        send("/api/auth/wechat/login", {
          method: "POST",
          data: { code, ...(referralCode ? { referralCode } : {}) },
        })
          .then((result) => {
            if (!current(attemptEpoch)) throw cancelled();
            wx.setStorageSync("agent_access_token", result.accessToken);
            if (result.agent?.id)
              wx.setStorageSync("agent_user_id", result.agent.id);
            resolve(result);
          })
          .catch(reject);
      },
      fail: reject,
    }),
  ).finally(() => {
    if (loginFlight === flight) loginFlight = null;
  });
  loginFlight = flight;
  return flight;
}
function request(path, options = {}) {
  const requestEpoch = epoch;
  if (stopped) return Promise.reject(cancelled());
  return send(path, options)
    .then((result) => {
      if (!current(requestEpoch)) throw cancelled();
      return result;
    })
    .catch(async (error) => {
      if (
        !current(requestEpoch) ||
        error.statusCode !== 401 ||
        options.noRenew ||
        (typeof getApp === "function" &&
          getApp().globalData.authenticated === false)
      )
        throw error;
      // Single-flight renewal; POST callers supply business idempotency keys.
      await login(undefined, true);
      if (!current(requestEpoch)) throw cancelled();
      const result = await send(path, options);
      if (!current(requestEpoch)) throw cancelled();
      return result;
    });
}
module.exports = {
  request,
  login,
  bindParent: (referralCode) =>
    request("/api/agent/bind-parent", {
      method: "POST",
      data: { referralCode },
    }),
  beginLogin: () => {
    stopped = false;
    return epoch;
  },
  getEpoch: () => epoch,
  isCurrent: current,
  logout: () => {
    const token = wx.getStorageSync("agent_access_token") || "";
    epoch += 1;
    stopped = true;
    loginFlight = null;
    wx.removeStorageSync("agent_access_token");
    if (typeof getApp === "function") {
      getApp().globalData.authenticated = false;
      getApp().globalData.loggedOut = true;
    }
    return send("/api/agent/logout", { method: "POST", token });
  },
};
