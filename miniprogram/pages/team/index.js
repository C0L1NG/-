const { request } = require('../../services/api')
Page({ data: { items: [] }, onShow() { request('/api/agent/team?page=1&pageSize=100').then(data => this.setData({ items: data.items.map(item => ({ ...item, joinedDate: item.joinedAt.slice(0, 10) })) })) } })
