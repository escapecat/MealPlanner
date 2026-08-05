// 食材搜索 —— 纯函数,不碰 DOM。
//
// ⚠️ 为什么单独抽出来:早先各处搜索是「按字典顺序过滤,取前 8 个」。
//    结果搜「鸡」时 鸡蛋 排第 9 位,被切掉了 —— 而它明明是最该出现的那个。
//    输给了鸡爪、鸡架,只因为它们在源文件里靠前。
//
//    「按字典顺序取前 N 个」= 按数据文件的书写顺序决定用户看到什么,
//    那是把内部存储顺序当成了相关度。

var Search = (function () {

  // 每个食材被多少道菜用到 —— 常用的该排前面。
  // 「鸡翅 鸡架 鸡爪 鸡蛋」都是两字、都以「鸡」开头,光靠字符串比不出高下;
  // 但鸡蛋出现在 67 道菜里,鸡爪只有 2 道 —— 这个数据本来就在库里。
  var _pop = null;
  function popularity(id) {
    if (!_pop) {
      _pop = {};
      RECIPES.forEach(function (r) {
        if (r.type === 'prep') return;
        var seen = {};
        (r.variants || []).forEach(function (v) {
          (v.ingredients || []).concat(v.seasonings || []).forEach(function (x) {
            x.ids.forEach(function (i) { seen[i] = 1; });
          });
        });
        Object.keys(seen).forEach(function (i) { _pop[i] = (_pop[i] || 0) + 1; });
      });
    }
    return _pop[id] || 0;
  }

  /** 相关度打分:分越低越靠前 */
  function score(ing, q) {
    var name = ing.name || '';
    var aliases = ing.aliases || [];
    var ql = q.toLowerCase();

    // 同档之内:常用的优先,再短的优先。pop 越大扣得越多(封顶 0.9,不越档)
    var tie = name.length * 0.01 - Math.min(0.9, popularity(ing.id) / 80);

    // ⚠️ 名字命中一律排在别名命中前面。
    //    早先把「别名开头」排在「名字中间」之前,于是搜「豆」时
    //    西洋菜(别名「豆瓣菜」)压过了油豆腐 —— 而用户看到的是名字,
    //    名字里没有「豆」的东西冒出来只会让人觉得搜索坏了。
    if (name.toLowerCase() === ql) return 0 + tie;              // 名字完全一样
    if (name.toLowerCase().indexOf(ql) === 0) return 2 + tie;   // 名字开头
    if (name.toLowerCase().indexOf(ql) > 0) return 4 + tie;     // 名字中间
    if (aliases.some(function (a) { return a.toLowerCase() === ql; })) return 6 + tie;
    if (aliases.some(function (a) { return a.toLowerCase().indexOf(ql) === 0; })) return 8 + tie;
    if (aliases.some(function (a) { return a.toLowerCase().indexOf(ql) >= 0; })) return 10 + tie;
    return 12 + tie;                                             // 只有 id 命中
  }

  /** 命中的是别名的话,把那个别名给出来 —— 否则「搜豆出来西洋菜」看着像坏了 */
  function matchedAlias(ing, q) {
    var ql = q.toLowerCase();
    if ((ing.name || '').toLowerCase().indexOf(ql) >= 0) return null;
    var hit = (ing.aliases || []).filter(function (a) {
      return a.toLowerCase().indexOf(ql) >= 0;
    })[0];
    return hit || null;
  }

  function matches(ing, q) {
    var hay = (ing.name || '') + ' ' + ing.id + ' ' + (ing.aliases || []).join(' ');
    return hay.toLowerCase().indexOf(q.toLowerCase()) >= 0;
  }

  /**
   * @param q      关键词
   * @param filter 可选的额外过滤(比如只要生鲜、只要调料)
   * @param limit  返回几个
   * 返回 {hits, total} —— total 用来告诉用户「还有 N 个没显示」,
   * 而不是让他以为就这些。
   */
  function find(q, filter, limit) {
    if (!q) return { hits: [], total: 0 };
    var all = INGREDIENTS.filter(function (i) {
      if (filter && !filter(i)) return false;
      return matches(i, q);
    });
    all.sort(function (a, b) { return score(a, q) - score(b, q); });
    return { hits: all.slice(0, limit || 12), total: all.length };
  }

  /**
   * 搜「类别」和「过敏原」—— 它们不是食材名,但用户会这么想。
   *
   * 「内脏」是个类别不是食材,搜出来 0 条;可是「我不吃内脏」是最常见的忌口之一。
   * 「花生过敏」要屏蔽的也不是 `花生米` 这一条,而是所有含花生的东西
   * (花生米 · 花生酱 · 花生油 —— 漏一个就出事)。
   *
   * 返回带 `@category:` / `@allergen:` 前缀的伪 id,Catalog.expandBlacklist 会展开。
   */
  function findGroups(q) {
    if (!q) return [];
    var ql = q.toLowerCase();
    var cats = {}, algs = {};
    INGREDIENTS.forEach(function (i) {
      if (i.category) cats[i.category] = (cats[i.category] || 0) + 1;
      (i.allergens || []).forEach(function (a) { algs[a] = (algs[a] || 0) + 1; });
    });
    var out = [];
    Object.keys(cats).forEach(function (c) {
      if (c.toLowerCase().indexOf(ql) >= 0) {
        out.push({ id: '@category:' + c, name: c, kind: 'category', count: cats[c] });
      }
    });
    Object.keys(algs).forEach(function (a) {
      if (a.toLowerCase().indexOf(ql) >= 0 || ql.indexOf(a.toLowerCase()) >= 0) {
        out.push({ id: '@allergen:' + a, name: a, kind: 'allergen', count: algs[a] });
      }
    });
    return out.sort(function (x, y) { return y.count - x.count; });
  }

  var FRESH = function (i) { return i.tier !== 'staple'; };
  var STAPLE = function (i) { return i.tier === 'staple'; };

  return { find: find, findGroups: findGroups, score: score, matches: matches,
           matchedAlias: matchedAlias, FRESH: FRESH, STAPLE: STAPLE };
})();

if (typeof module !== 'undefined') module.exports = Search;
