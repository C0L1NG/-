const { WEB_BASE_URL } = require("../../config");
Page({
  data: { url: "" },
  onLoad(options) {
    let url = "";
    try {
      url = decodeURIComponent(options.url || "");
    } catch (_) {}
    if (!WEB_BASE_URL || !url.startsWith(WEB_BASE_URL + "/login/#"))
      return wx.navigateBack();
    this.setData({ url });
  },
});
