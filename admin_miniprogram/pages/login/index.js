const { login } = require("../../services/api");
Page({
  data: { username: "", password: "", error: "", busy: false },
  username(e) {
    this.setData({ username: e.detail.value });
  },
  password(e) {
    this.setData({ password: e.detail.value });
  },
  submit() {
    this.run({ username: this.data.username, password: this.data.password });
  },
  wechat() {
    this.run();
  },
  run(credentials) {
    this.setData({ busy: true, error: "" });
    login(credentials)
      .then(() => {
        this.setData({ password: "" });
        wx.switchTab({ url: "/pages/dashboard/index" });
      })
      .catch((e) => this.setData({ error: e.message }))
      .finally(() => this.setData({ busy: false }));
  },
});
