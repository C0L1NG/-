App({
  onLaunch() {
    if (!wx.getStorageSync("admin_access_token"))
      wx.reLaunch({ url: "/pages/login/index" });
  },
});
