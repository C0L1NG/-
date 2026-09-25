const { request } = require('../../services/api')

function monthRange() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()
  const start = `${year}-${String(month + 1).padStart(2, '0')}-01`
  const endDate = new Date(Date.UTC(year, month + 1, 1))
  const end = `${endDate.getUTCFullYear()}-${String(endDate.getUTCMonth() + 1).padStart(2, '0')}-01`
  return { start, end }
}

function cents(value) {
  const normalized = String(value || '0').replace(/,/g, '')
  const [whole = '0', fraction = ''] = normalized.split('.')
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2))
}

function displayMoney(value) {
  const normalized = String(value || '0.00').replace(/,/g, '')
  const [whole, fraction = '00'] = normalized.split('.')
  return `${Number(whole).toLocaleString('en-US')}.${fraction.padEnd(2, '0').slice(0, 2)}`
}

function recentItem(item) {
  const own = item.roleType === 'PROMOTER'
  return {
    id: item.id,
    orderNo: item.orderNo,
    orderShort: item.orderNo.split('-').slice(-1)[0],
    title: own ? '直推成交' : '团队奖励',
    iconClass: own ? 'activity-icon--own' : 'activity-icon--team',
    roleType: item.roleType,
    sourceText: own ? '自身出单' : '下线团队抽成',
    rate: `${item.ratePercent}%`,
    time: item.settledAt ? item.settledAt.slice(11, 16) : '—',
    fullTime: item.settledAt ? item.settledAt.slice(0, 16).replace('T', ' ') : '—',
    profitAmount: displayMoney(item.orderProfitAmount),
    amount: displayMoney(item.commissionAmount)
  }
}

Page({
  data: {
    statusBarHeight: wx.getWindowInfo ? wx.getWindowInfo().statusBarHeight : wx.getSystemInfoSync().statusBarHeight,
    loading: true,
    balance: '—',
    balanceLong: false,
    amountHidden: false,
    totalEarned: '—',
    todayEstimated: '—',
    monthEarned: '—',
    monthEarnedShort: '—',
    directAgentCount: 0,
    nickname: '代理伙伴',
    initials: '代理',
    identity: '合伙人账户',
    teamFaces: [],
    activity: [],
    filteredActivity: [],
    activityFilter: 'all',
    activityFilterLabel: '全部',
    filterOpen: false,
    referralCode: ''
  },

  onShow() {
    const ready = getApp().ready || Promise.resolve()
    ready.then(() => this.loadDashboard()).catch(() => {
      this.setData({ loading: false })
      wx.showToast({ title: '登录失败，请重试', icon: 'none' })
    })
  },

  onPullDownRefresh() {
    this.loadDashboard().finally(() => wx.stopPullDownRefresh())
  },

  loadDashboard() {
    this.setData({ loading: true })
    const requests = [
      request('/api/agent/overview'),
      request('/api/agent/ledger?page=1&pageSize=6'),
      request('/api/agent/team?page=1&pageSize=3'),
      request('/api/agent/referral')
    ]
    return Promise.all(requests).then(([overview, ledger, team, referral]) => {
      this.setData({
        loading: false,
        balance: displayMoney(overview.balance),
        balanceLong: displayMoney(overview.balance).length > 10,
        totalEarned: displayMoney(overview.totalEarned),
        todayEstimated: displayMoney(overview.todayEstimatedEarnings),
        directAgentCount: overview.directAgentCount,
        nickname: overview.displayName || '代理伙伴',
        initials: (overview.displayName || '代理伙伴').slice(0, 2),
        identity: overview.currentCommissionRatePercent === 49 ? 'Lv.2 合伙人' : 'Lv.1 合伙人',
        teamFaces: (team.items || []).map((person, index) => ({ id: person.id, initial: (person.displayName || '代').slice(0, 1), index })),
        activity: (ledger.items || []).map(recentItem),
        filteredActivity: (ledger.items || []).map(recentItem),
        activityFilter: 'all',
        activityFilterLabel: '全部',
        referralCode: referral.referralCode
      })
      return this.loadMonthEarnings()
    }).catch(() => {
      this.setData({ loading: false })
      wx.showToast({ title: '数据加载失败', icon: 'none' })
    })
  },

  loadMonthEarnings() {
    const { start, end } = monthRange()
    let totalCents = 0
    const fetchPage = (page) => request(`/api/agent/ledger?page=${page}&pageSize=100&from=${start}&to=${end}`)
      .then((result) => {
        for (const item of result.items || []) totalCents += cents(item.commissionAmount)
        if (page < result.totalPages) return fetchPage(page + 1)
        const monthEarned = displayMoney((totalCents / 100).toFixed(2))
        this.setData({ monthEarned, monthEarnedShort: monthEarned.split('.')[0] })
      })
    return fetchPage(1).catch(() => this.setData({ monthEarned: '—', monthEarnedShort: '—' }))
  },

  openSettlement() {
    wx.showModal({
      title: '申请提现',
      content: '提现申请通道尚未接入。当前可用余额可在此查看，正式申请请联系平台管理员。',
      showCancel: false,
      confirmText: '知道了'
    })
  },

  openPoster() { wx.switchTab({ url: '/pages/referral/index' }) },
  openTeam() { wx.switchTab({ url: '/pages/team/index' }) },
  openLedger() { wx.switchTab({ url: '/pages/ledger/index' }) },
  toggleBalance() { this.setData({ amountHidden: !this.data.amountHidden }) },
  toggleFilter() { this.setData({ filterOpen: !this.data.filterOpen }) },
  chooseFilter(event) {
    const filter = event.currentTarget.dataset.filter
    const filteredActivity = this.data.activity.filter((item) =>
      filter === 'all' || (filter === 'own' ? item.roleType === 'PROMOTER' : item.roleType === 'PARENT'))
    this.setData({
      activityFilter: filter,
      activityFilterLabel: filter === 'all' ? '全部' : filter === 'own' ? '自己出单' : '团队奖励',
      filteredActivity,
      filterOpen: false
    })
  },
  openActivity(event) {
    const item = this.data.activity.find((row) => row.id === event.currentTarget.dataset.id)
    if (!item) return
    wx.showModal({
      title: item.title,
      content: '订单 ' + item.orderNo + '\n订单利润池 ¥' + item.profitAmount +
        '\n分成比例 ' + item.rate + '\n实际到账 +¥' + item.amount +
        '\n结算时间 ' + item.fullTime + ' UTC',
      showCancel: false,
      confirmText: '知道了'
    })
  },
  copyReferralCode() {
    if (!this.data.referralCode) return
    wx.setClipboardData({ data: this.data.referralCode, success: () => wx.showToast({ title: '邀请码已复制' }) })
  }
})
