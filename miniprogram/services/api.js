const { API_BASE_URL } = require('../config')

function request(path, options = {}) {
  return new Promise((resolve, reject) => wx.request({
    url: `${API_BASE_URL}${path}`,
    method: options.method || 'GET', data: options.data,
    header: { Authorization: `Bearer ${wx.getStorageSync('agent_access_token') || ''}`, 'Content-Type': 'application/json' },
    success: ({ statusCode, data }) => statusCode >= 200 && statusCode < 300 ? resolve(data) : reject(Object.assign(new Error(data.message || '请求失败'), { statusCode, data })),
    fail: reject
  }))
}

function login() {
  return new Promise((resolve, reject) => wx.login({
    success: ({ code }) => request('/api/auth/wechat/login', { method: 'POST', data: { code } })
      .then((result) => { wx.setStorageSync('agent_access_token', result.accessToken); resolve(result) }).catch(reject),
    fail: reject
  }))
}

module.exports = {
  request, login,
  bindParent: (referralCode) => request('/api/agent/bind-parent', { method: 'POST', data: { referralCode } })
}
