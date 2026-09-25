const api = require('./services/api')

App({
  globalData: { pendingReferral: '' },
  onLaunch(options) {
    const scene = decodeURIComponent((options.query && options.query.scene) || '')
    this.globalData.pendingReferral = scene.startsWith('r=') ? scene.slice(2) : ((options.query && options.query.ref) || '')
    this.ready = api.login()
    this.ready.then(() => {
      if (this.globalData.pendingReferral) {
        api.bindParent(this.globalData.pendingReferral)
          .catch(() => wx.showToast({ title: '邀请码绑定失败', icon: 'none' }))
      }
    }).catch(() => wx.showToast({ title: '登录失败，请重试', icon: 'none' }))
  }
})
