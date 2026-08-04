// 存储抽象层 —— 迁小程序时只有这一个文件要改(DESIGN.md 第二节)
//   浏览器:localStorage        小程序:wx.getStorageSync / wx.setStorageSync
// 业务代码全程只调 Store.get/set,不许直接碰 localStorage。

var Store = (function () {
  var NS = 'mealplanner:';

  function get(key, fallback) {
    try {
      var raw = localStorage.getItem(NS + key);
      if (raw === null) return fallback === undefined ? null : fallback;
      var v = JSON.parse(raw);
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      // 防御式 load:存坏了不要让整个应用打不开(MahjongScorer2 采纳的做法)
      console.warn('[Store] 读取失败,回退默认值:', key, e);
      return fallback === undefined ? null : fallback;
    }
  }

  function set(key, value) {
    try {
      localStorage.setItem(NS + key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('[Store] 写入失败(可能超配额):', key, e);
      return false;
    }
  }

  function remove(key) {
    try { localStorage.removeItem(NS + key); } catch (e) {}
  }

  function keys() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.indexOf(NS) === 0) out.push(k.slice(NS.length));
      }
    } catch (e) {}
    return out;
  }

  // 整库导出/导入 —— 数据不能丢,带 version 便于以后迁移
  function exportAll() {
    var data = {};
    keys().forEach(function (k) { data[k] = get(k); });
    return { version: 1, exportedAt: new Date().toISOString(), data: data };
  }

  function importAll(payload) {
    if (!payload || typeof payload !== 'object' || !payload.data) {
      throw new Error('不是有效的备份文件');
    }
    Object.keys(payload.data).forEach(function (k) { set(k, payload.data[k]); });
    return Object.keys(payload.data).length;
  }

  return { get: get, set: set, remove: remove, keys: keys,
           exportAll: exportAll, importAll: importAll };
})();

if (typeof module !== 'undefined') module.exports = Store;
