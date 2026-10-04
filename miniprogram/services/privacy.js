const STORAGE_KEY = "agent_amounts_hidden";

function readPrivacy() {
  try {
    return wx.getStorageSync(STORAGE_KEY) === true;
  } catch (_) {
    // If preferences cannot be read, avoid revealing balances by default.
    return true;
  }
}

function syncPrivacy(page) {
  page.setData({ hidden: readPrivacy() });
}

function togglePrivacy(page) {
  const hidden = !page.data.hidden;
  try {
    wx.setStorageSync(STORAGE_KEY, hidden);
  } catch (_) {
    wx.showToast({ title: "隐私设置保存失败，请重试", icon: "none" });
    return;
  }
  page.setData({ hidden });
}

module.exports = { syncPrivacy, togglePrivacy };
