const { request } = require('../../services/api')

Page({
  data: { referral: null, codePath: '', posterPath: '', loading: true },

  onLoad() {
    Promise.all([request('/api/agent/referral'), request('/api/agent/mini-program-code')])
      .then(([referral, code]) => {
        const path = wx.env.USER_DATA_PATH + '/agent-code.png'
        wx.getFileSystemManager().writeFile({
          filePath: path,
          data: code.imageDataUrl.split(',')[1],
          encoding: 'base64',
          success: () => {
            this.setData({ referral, codePath: path })
            this.drawPoster(path)
          },
          fail: () => this.setData({ loading: false })
        })
      })
      .catch(() => {
        this.setData({ loading: false })
        wx.showToast({ title: '推广码生成失败', icon: 'none' })
      })
  },

  drawPoster(codePath) {
    const ctx = wx.createCanvasContext('poster', this)
    ctx.setFillStyle('#F6F7F2')
    ctx.fillRect(0, 0, 600, 900)
    ctx.setFillStyle('#132A00')
    ctx.fillRect(0, 0, 600, 280)
    ctx.setFillStyle('#9FE870')
    ctx.beginPath()
    ctx.arc(560, 20, 175, 0, Math.PI * 2)
    ctx.fill()
    ctx.setFillStyle('#C9D8BD')
    ctx.setFontSize(22)
    ctx.fillText('YOUR INVITE', 52, 72)
    ctx.setFillStyle('#FFFFFF')
    ctx.setFontSize(43)
    ctx.fillText('和伙伴一起，', 52, 148)
    ctx.fillText('让好收益发生。', 52, 208)
    ctx.setFillStyle('#FFFFFF')
    ctx.fillRect(62, 325, 476, 476)
    ctx.drawImage(codePath, 106, 369, 388, 388)
    ctx.setFillStyle('#132A00')
    ctx.setFontSize(24)
    ctx.fillText('专属邀请码  ' + this.data.referral.referralCode, 62, 842)
    ctx.draw(false, () => wx.canvasToTempFilePath({
      canvasId: 'poster', width: 600, height: 900,
      success: ({ tempFilePath }) => this.setData({ posterPath: tempFilePath, loading: false }),
      fail: () => this.setData({ loading: false })
    }, this))
  },

  savePoster() {
    if (!this.data.posterPath) return
    wx.saveImageToPhotosAlbum({
      filePath: this.data.posterPath,
      success: () => wx.showToast({ title: '海报已保存' }),
      fail: () => wx.showToast({ title: '保存失败，请检查相册权限', icon: 'none' })
    })
  }
})
