const { API_BASE_URL } = require("../config");
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
function send(path, options = {}) {
  return new Promise((resolve, reject) =>
    wx.request({
      url: API_BASE_URL + path,
      method: options.method || "GET",
      data: options.data,
      header: {
        Authorization:
          "Bearer " +
          (options.token ?? (wx.getStorageSync("admin_access_token") || "")),
        "Content-Type": "application/json",
      },
      success: ({ statusCode, data }) =>
        statusCode >= 200 && statusCode < 300
          ? resolve(data)
          : reject(
              Object.assign(
                new Error(data.message || data.code || "请求失败"),
                { statusCode },
              ),
            ),
      fail: reject,
    }),
  );
}
function login(credentials, renew = false) {
  if (renew && stopped) return Promise.reject(cancelled());
  stopped = false;
  const attemptEpoch = epoch;
  if (loginFlight) return loginFlight;
  const flight = Promise.resolve()
    .then(() =>
      credentials
        ? send("/api/auth/admin/login", { method: "POST", data: credentials })
        : new Promise((resolve, reject) =>
            wx.login({
              success: ({ code }) => {
                if (!current(attemptEpoch)) return reject(cancelled());
                return send("/api/auth/wechat/admin-login", {
                  method: "POST",
                  data: { code },
                })
                  .then(resolve)
                  .catch(reject);
              },
              fail: reject,
            }),
          ),
    )
    .then((result) => {
      if (!current(attemptEpoch)) throw cancelled();
      wx.setStorageSync("admin_access_token", result.accessToken);
      wx.setStorageSync(
        "admin_login_method",
        credentials ? "password" : "wechat",
      );
      return result;
    })
    .finally(() => {
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
      if (!current(requestEpoch) || options.noRenew || error.statusCode !== 401)
        throw error;
      if (wx.getStorageSync("admin_login_method") === "wechat") {
        await login(undefined, true);
        if (!current(requestEpoch)) throw cancelled();
        const result = await send(path, options);
        if (!current(requestEpoch)) throw cancelled();
        return result;
      }
      wx.reLaunch({ url: "/pages/login/index" });
      throw error;
    });
}
function logout() {
  const token = wx.getStorageSync("admin_access_token") || "";
  epoch += 1;
  stopped = true;
  loginFlight = null;
  wx.removeStorageSync("admin_access_token");
  wx.removeStorageSync("admin_login_method");
  return send("/api/auth/admin/logout", { method: "POST", token });
}
module.exports = {
  request,
  login,
  logout,
  getEpoch: () => epoch,
  isCurrent: current,
};
