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

  /**
   * 先验一遍再决定这份备份能不能用 —— **不写任何东西**。
   * @return {ok, why, summary} —— 让界面在覆盖前把「要盖掉什么」说清楚。
   *
   * ⚠️ 导入是这个 app 里**唯一一个不可撤销**的写操作:盖掉之后原来的没了。
   *    所以必须「先全验完、再一次性写」,不能边验边写 ——
   *    验到一半抛异常的话,你的数据是**半新半旧**的,那比彻底失败还糟。
   */
  function inspectImport(payload) {
    if (!payload || typeof payload !== 'object') return { ok: false, why: '不是 JSON 对象' };
    if (!payload.data || typeof payload.data !== 'object') {
      return { ok: false, why: '缺 data 字段 —— 多半不是这个 app 导出的' };
    }
    if (payload.version == null) return { ok: false, why: '缺 version 字段' };
    if (payload.version > 1) {
      return { ok: false, why: '备份是 v' + payload.version + ' 的,这个版本读不了' };
    }
    var d = payload.data;
    // 形状对不对:该是数组的必须是数组,否则导进去到处崩
    var mustArray = ['rounds', 'pantryItems', 'staples', 'wasteLog', 'weightLog'];
    for (var i = 0; i < mustArray.length; i++) {
      var k = mustArray[i];
      if (d[k] !== undefined && !Array.isArray(d[k])) {
        return { ok: false, why: k + ' 应该是个数组,实际是 ' + typeof d[k] };
      }
    }
    return {
      ok: true,
      summary: {
        rounds: (d.rounds || []).length,
        pantry: (d.pantryItems || []).length,
        staples: (d.staples || []).length,
        waste: (d.wasteLog || []).length,
        at: payload.exportedAt || null,
      },
    };
  }

  function importAll(payload) {
    var chk = inspectImport(payload);
    if (!chk.ok) throw new Error(chk.why);
    // 全验完了才动手写
    Object.keys(payload.data).forEach(function (k) { set(k, payload.data[k]); });
    return Object.keys(payload.data).length;
  }

  return { get: get, set: set, remove: remove, keys: keys,
           exportAll: exportAll, importAll: importAll,
           inspectImport: inspectImport };
})();

if (typeof module !== 'undefined') module.exports = Store;
