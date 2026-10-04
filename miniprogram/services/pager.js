const { request } = require("./api");
// Versioned requests prevent an old month/filter response overwriting a new selection.
function pageLoader(page, path) {
  const version = page._version || 0;
  if (page.data.loading || page.data.page >= page.data.totalPages)
    return Promise.resolve();
  const next = page.data.page + 1;
  page.setData({ loading: true, error: "" });
  return request(path(next))
    .then((result) => {
      if ((page._version || 0) !== version) return;
      const seen = new Set(page.data.items.map((item) => item.id));
      page.setData({
        items: [
          ...page.data.items,
          ...result.items
            .filter((item) => !seen.has(item.id))
            .map((item) => ({
              ...item,
              displayAmount: String(item.commissionAmount ?? "").replace(
                /^-/,
                "",
              ),
            })),
        ],
        page: result.page,
        totalPages: result.totalPages,
        total: result.total,
      });
    })
    .catch((error) => {
      if ((page._version || 0) === version)
        page.setData({ error: error.message || "加载失败" });
    })
    .finally(() => {
      if ((page._version || 0) === version) page.setData({ loading: false });
    });
}
function reset(page) {
  page._version = (page._version || 0) + 1;
  page.setData({
    items: [],
    page: 0,
    totalPages: 1,
    total: 0,
    loading: false,
    error: "",
  });
}
module.exports = { pageLoader, reset };
