// 包装规格解析 —— 纯函数,不碰 DOM。
//
// 为什么需要这一层:结构化的 PACKAGES 只有 135 条,覆盖 27% 的主料;
// 但食材字典的「常见包装」文字覆盖剩下的 100%(两样都没有的是 0 种)。
// 数据是全的,只是一半写成了给人读的形式:
//     「冷鲜盒装 200-300g;现绞按需」「10枚/盒 500g」「300g/盒 / 400g/块」
// 把它解析出来,求解器的可用范围从 27% 变成 100%。
//
// ⚠️ 解析出来的可信度一律标 C,低于 PACKAGES 里用户核对过的 A。
//    宁可标低也不要让求解器以为自己知道得很准。

var Packaging = (function () {

  // 「300g」「500 ml」「约1500g」「200-300g」→ 取下限(保守,宁可少买一次不如剩一堆)
  var SIZE = /(?:约)?(\d+(?:\.\d+)?)\s*(?:-\s*(\d+(?:\.\d+)?))?\s*(kg|g|ml|L|升)/gi;
  var COUNT = /(\d+)\s*(枚|只|个|片|张|棵|条|根|包|盒|袋|瓶)/g;

  function toGrams(n, unit) {
    var u = (unit || 'g').toLowerCase();
    if (u === 'kg') return n * 1000;
    if (u === 'l' || u === '升') return n * 1000;   // 按水近似,只用于估包装大小
    return n;
  }

  /** 从「常见包装」这类文字里抠出候选规格,按从小到大排 —— 一人食优先小包装 */
  function parseText(text) {
    if (!text) return [];
    var out = [];
    var seen = {};
    var m;
    SIZE.lastIndex = 0;
    while ((m = SIZE.exec(text)) !== null) {
      var lo = parseFloat(m[1]);
      var g = toGrams(lo, m[3]);
      if (!g || g > 20000) continue;
      var key = Math.round(g);
      if (seen[key]) continue;
      seen[key] = 1;
      out.push({
        netWeight: g,
        unit: /ml|l|升/i.test(m[3]) ? 'ml' : 'g',
        range: m[2] ? [lo, parseFloat(m[2])] : null,
        raw: m[0],
      });
    }
    return out.sort(function (a, b) { return a.netWeight - b.netWeight; });
  }

  /** 计件类:「10枚/盒」「2棵约500g」—— 记下件数,配合字典的 unitConv 才能换算 */
  function parseCount(text) {
    if (!text) return [];
    var out = [], m;
    COUNT.lastIndex = 0;
    while ((m = COUNT.exec(text)) !== null) {
      out.push({ qty: parseInt(m[1], 10), unit: m[2] });
    }
    return out;
  }

  var _pkgIndex = null;
  function pkgIndex() {
    if (!_pkgIndex) {
      _pkgIndex = {};
      // 用 PackagesUI.merged() 才能拿到用户改过/自己加的;它不在时退回原始 PACKAGES
      var src = (typeof PackagesUI !== 'undefined' && PackagesUI.merged)
        ? PackagesUI.merged() : PACKAGES;
      src.forEach(function (p) {
        (_pkgIndex[p.ingredientId] = _pkgIndex[p.ingredientId] || []).push(p);
      });
    }
    return _pkgIndex;
  }
  function invalidate() { _pkgIndex = null; }

  /**
   * 某个食材能怎么买。结构化条目优先,没有就从字典文字解析。
   * 返回按包装大小升序的候选,每条带 confidence。
   */
  function optionsFor(ingredientId) {
    var idx = pkgIndex();
    var out = [];

    (idx[ingredientId] || []).forEach(function (p) {
      if (p.netWeight == null) return;
      out.push({
        source: 'package', id: p.id, name: p.name,
        netWeight: p.netWeight, unit: p.unit || 'g',
        price: p.price, sellMode: p.sellMode,
        confidence: p.confidence || 'C',
      });
    });

    var ing = INGREDIENTS.filter(function (i) { return i.id === ingredientId; })[0];
    if (ing) {
      parseText(ing.packaging).forEach(function (s) {
        // 已经有同样大小的结构化条目就不重复加
        if (out.some(function (o) { return Math.abs(o.netWeight - s.netWeight) < 1; })) return;
        out.push({
          source: 'dict', id: null,
          name: ing.name + ' ' + s.raw,
          netWeight: s.netWeight, unit: s.unit,
          price: null, sellMode: null,
          confidence: 'C',            // 从文字解析的,一律标最低
          parsedFrom: ing.packaging,
        });
      });
    }
    return out.sort(function (a, b) { return a.netWeight - b.netWeight; });
  }

  /** 一人食优先最小规格 —— 「买大包更便宜」在一个人这里通常是假省钱 */
  function smallest(ingredientId) {
    var o = optionsFor(ingredientId);
    return o.length ? o[0] : null;
  }

  /** 要 needGrams 克,按这个规格得买几包、会剩多少 */
  function plan(ingredientId, needGrams) {
    var opt = smallest(ingredientId);
    if (!opt) return null;
    var packs = Math.max(1, Math.ceil(needGrams / opt.netWeight));
    var total = packs * opt.netWeight;
    return {
      option: opt, packs: packs, total: total,
      leftover: total - needGrams,
      leftoverRatio: (total - needGrams) / total,
    };
  }

  return {
    parseText: parseText, parseCount: parseCount,
    optionsFor: optionsFor, smallest: smallest, plan: plan,
    invalidate: invalidate,
  };
})();

if (typeof module !== 'undefined') module.exports = Packaging;
