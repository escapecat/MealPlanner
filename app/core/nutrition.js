// 营养核算 —— 纯函数,不碰 DOM。
//
// ⚠️ 一顿饭 ≠ 一道菜。
//    库里 512 道菜有 197 道自带主食(焖饭/面/盖饭,中位 618 kcal),
//    315 道不带(清炒时蔬那类,中位 352 kcal)。
//    早先按「一道菜 = 一顿饭」核算,得出中位 354 kcal、达标率 15% ——
//    那不是求解器选错了菜,是核算漏了那碗饭。
//
// 所以:不带主食的菜,自动补一份主食再算。这也影响采购 —— 米面是 staple 档,
// 不进每周清单,但份量要算进去(不然米缸什么时候空的你也不知道)。

var Nutrition = (function () {

  var DEFAULT_STAPLE = 'rice';
  var STAPLE_GRAMS = 90;      // 生重。字典里 rice 的「单次用量」就是 90g

  function ing(id) {
    return INGREDIENTS.filter(function (i) { return i.id === id; })[0] || null;
  }

  /** 把一个食材项折成克 —— 计件的(2个鸡蛋)靠字典的单位换算 */
  function gramsOf(item) {
    if (item.grams != null) return item.grams;
    if (item.qty && item.unit) {
      var i = ing(item.ids[0]);
      if (i && i.unitConv && i.unitConv[item.unit]) return item.qty * i.unitConv[item.unit];
    }
    return null;
  }

  function accumulate(items, acc) {
    items.forEach(function (x) {
      var i = ing(x.ids[0]);
      if (!i) return;
      var g = gramsOf(x);
      if (g == null) return;
      if (i.per100g) {
        acc.kcal += g * (i.per100g.kcal || 0) / 100;
        acc.protein += g * (i.per100g.protein || 0) / 100;
        acc.carb += g * (i.per100g.carb || 0) / 100;
        acc.fat += g * (i.per100g.fat || 0) / 100;
      }
      if (i.countsAsVeg) acc.veg += g;
      if (x.role === 'staple') acc.hasStaple = true;
    });
  }

  /** 这道菜本身的营养(不补主食) */
  function ofVariant(v) {
    var acc = { kcal: 0, protein: 0, carb: 0, fat: 0, veg: 0, hasStaple: false };
    accumulate(v.ingredients || [], acc);
    return acc;
  }

  /** 一顿饭的营养 —— 菜不带主食就自动配一份 */
  function ofMeal(v, stapleId, stapleGrams) {
    var acc = ofVariant(v);
    var added = null;
    if (!acc.hasStaple) {
      var sid = stapleId || DEFAULT_STAPLE;
      var s = ing(sid);
      var g = stapleGrams || STAPLE_GRAMS;
      if (s && s.per100g) {
        acc.kcal += g * (s.per100g.kcal || 0) / 100;
        acc.protein += g * (s.per100g.protein || 0) / 100;
        acc.carb += g * (s.per100g.carb || 0) / 100;
        added = { ingredientId: sid, name: s.name, grams: g };
      }
    }
    return {
      kcal: Math.round(acc.kcal), protein: Math.round(acc.protein),
      carb: Math.round(acc.carb), fat: Math.round(acc.fat),
      veg: Math.round(acc.veg),
      staple: added,               // 补了什么主食,UI 要显示出来
      selfContained: acc.hasStaple,
    };
  }

  /** 离目标差多少 —— 0 = 达标,1 = 完全没到 */
  function shortfall(n, target) {
    if (!target) return 0;
    function miss(actual, want) { return want ? Math.max(0, (want - actual) / want) : 0; }
    // 蛋白和蔬菜权重更高:热量少一点不要紧,蛋白不够是真问题
    return miss(n.kcal, target.kcal) * 0.5
         + miss(n.protein, target.protein) * 1.0
         + miss(n.veg, target.veg) * 0.7;
  }

  return {
    DEFAULT_STAPLE: DEFAULT_STAPLE, STAPLE_GRAMS: STAPLE_GRAMS,
    gramsOf: gramsOf, ofVariant: ofVariant, ofMeal: ofMeal, shortfall: shortfall,
  };
})();

if (typeof module !== 'undefined') module.exports = Nutrition;
