// 菜谱校准层 —— 纯函数,不碰 DOM。
//
// ⚠️ 这和「在 app 里加一道新菜」是两回事,别混为一谈:
//
//   加新菜   → 菜谱库就有了两个正本(markdown 一份、浏览器一份),
//              清缓存就没、换设备带不走、重新构建又变回去。**没做,是对的。**
//   校准     → 库里的事实不动,只记**你和默认值的差**。
//              「红烧肉要五花肉」是共享事实;
//              「我做要 40 分钟」「我家没空气炸锅」「这道我吃着不辣」是你的。
//
// 这个模式代码里已经有了:Packaging.merged() 就是「默认规格 + 你在超市改的」。
// 这里是同一件事,换个对象。
//
// 存的是 diff 不是整份拷贝 —— 所以以后我改了菜谱库(补了道菜、修了个克数),
// 你的校准仍然贴在新数据上,不会把你锁在一份过期快照里。

var RecipeBook = (function () {

  var BASE = null;          // 原始数据的深拷贝,永远不动
  var CAL_KEY = 'recipeOverrides';

  function overrides() { return Store.get(CAL_KEY, {}) || {}; }

  /** @return {activeMinutes, totalMinutes, difficulty, spicy, equipmentRequired, grams:{id:g}} */
  function overrideOf(recipeId, prepLevel) {
    var o = overrides()[recipeId];
    if (!o) return null;
    return (prepLevel && o.byLevel && o.byLevel[prepLevel]) || o.all || null;
  }

  function hasOverride(recipeId) { return !!overrides()[recipeId]; }
  function count() { return Object.keys(overrides()).length; }

  function applyTo(recipe) {
    var o = overrides()[recipe.id];
    if (!o) return recipe;
    var out = Object.assign({}, recipe);
    var top = o.all || {};

    if (top.spicy != null) out.spicy = top.spicy;
    if (top.equipmentRequired) out.equipmentRequired = top.equipmentRequired.slice();
    out.userEdited = true;

    out.variants = (recipe.variants || []).map(function (v) {
      var lv = Object.assign({}, top, (o.byLevel && o.byLevel[v.prepLevel]) || {});
      if (!Object.keys(lv).length) return v;
      var nv = Object.assign({}, v);
      if (lv.activeMinutes != null) nv.activeMinutes = lv.activeMinutes;
      if (lv.totalMinutes != null) nv.totalMinutes = lv.totalMinutes;
      if (lv.difficulty != null) nv.difficulty = lv.difficulty;
      if (lv.aheadOfTime !== undefined) nv.aheadOfTime = lv.aheadOfTime;
      if (lv.equipmentRequired) nv.equipmentRequired = lv.equipmentRequired.slice();

      // 克数改动:按食材 id 覆盖。qty/grams 一起改 ——
      // grams 是求解器和采购清单用的,qty 是显示用的,只改一个会对不上。
      if (lv.grams) {
        nv.ingredients = (v.ingredients || []).map(function (it) {
          var g = lv.grams[it.ids[0]];
          if (g == null) return it;
          var ni = Object.assign({}, it);
          ni.grams = g;
          if (ni.unit === 'g' || ni.unit == null) ni.qty = g;
          ni.userEdited = true;
          return ni;
        });
      }

      // 去掉的食材 —— 「这道我不放香菜」
      //
      // ⚠️ 允许去掉主料。看着危险,但拦下来更糟:
      //    求解器的硬约束是「主料必须在采购清单上」,而清单是从最终选定的菜倒算的,
      //    所以去掉一样主料的效果是「这道菜少买一样」,不是「清单和菜对不上」。
      //    真去掉光了(一样主料不剩),下面会把这道菜整个跳过。
      if (lv.remove && lv.remove.length) {
        var rm = {};
        lv.remove.forEach(function (id) { rm[id] = 1; });
        nv.ingredients = (nv.ingredients || v.ingredients || []).filter(function (it) {
          return !rm[it.ids[0]];
        });
        nv.seasonings = (v.seasonings || []).filter(function (it) { return !rm[it.ids[0]]; });
      }

      // 加进去的食材 —— 「我做红烧肉会加土豆」
      if (lv.add && lv.add.length) {
        var base = (nv.ingredients || v.ingredients || []).slice();
        lv.add.forEach(function (a) {
          if (base.some(function (it) { return it.ids[0] === a.id; })) return;
          var ing = INGREDIENTS.filter(function (x) { return x.id === a.id; })[0];
          base.push({
            ids: [a.id], names: [ing ? ing.name : a.id],
            qty: a.grams, unit: 'g', grams: a.grams,
            role: a.role || 'side', toTaste: false, userAdded: true,
          });
        });
        nv.ingredients = base;
      }
      // ⚠️ 总时长不能小于动手时间 —— 用户只改了一个的话,把另一个顶上去,
      //    否则 Timing 会算出负数的「空等」。
      if (nv.totalMinutes != null && nv.activeMinutes != null &&
          nv.totalMinutes < nv.activeMinutes) {
        nv.totalMinutes = nv.activeMinutes;
      }
      nv.userEdited = true;
      return nv;
    });
    return out;
  }

  /**
   * 把校准应用到全局 RECIPES 上。
   *
   * ⚠️ 直接换掉全局数组,而不是让每个调用点改走 RecipeBook.get() ——
   *    RECIPES 在 core 和 ui 里有几十处引用,逐个改的风险远大于收益,
   *    而且漏一处就是「菜谱页显示改过的、求解器用的还是原来的」这种
   *    最难查的不一致。换全局的话,不存在漏网的调用点。
   */
  function init() {
    if (!BASE) BASE = JSON.parse(JSON.stringify(RECIPES));
    var merged = BASE.map(applyTo);
    // 一样主料都不剩的菜直接排除 —— 用户可以把主料删光,但那样这道菜就不成立了,
    // 留着会让求解器排出一道「什么都不用买」的空菜。
    merged = merged.filter(function (r) {
      if (!r.userEdited) return true;
      return (r.variants || []).some(function (v) {
        return (v.ingredients || []).length > 0;
      });
    });
    if (typeof window !== 'undefined') window.RECIPES = merged;
    else RECIPES = merged;
    return merged;
  }

  function save(recipeId, patch, prepLevel) {
    var all = overrides();
    var o = all[recipeId] || {};
    if (prepLevel) {
      o.byLevel = o.byLevel || {};
      o.byLevel[prepLevel] = Object.assign({}, o.byLevel[prepLevel], patch);
    } else {
      o.all = Object.assign({}, o.all, patch);
    }
    o.editedAt = new Date().toISOString();
    all[recipeId] = o;
    Store.set(CAL_KEY, all);
    return init();
  }

  function reset(recipeId) {
    var all = overrides();
    if (recipeId) delete all[recipeId];
    else all = {};
    Store.set(CAL_KEY, all);
    return init();
  }

  /** 原始值 —— 「你改成了 40 分,库里写的是 25 分」要能对照着看 */
  function original(recipeId) {
    if (!BASE) return null;
    return BASE.filter(function (r) { return r.id === recipeId; })[0] || null;
  }

  return { init: init, save: save, reset: reset, original: original,
           overrides: overrides, overrideOf: overrideOf,
           hasOverride: hasOverride, count: count, applyTo: applyTo };
})();

if (typeof module !== 'undefined') module.exports = RecipeBook;
