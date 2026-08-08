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

  /**
   * 蛋白不够,**先把主料加量** —— 比另外加一样东西自然得多。
   *
   * 「鸡胸 150g → 220g」不用多买一样、不用多做一步,而
   * 「鸡胸 150g + 一罐金枪鱼」是硬塞。所以这一步在补充项之前。
   *
   * ⚠️ 但加量救不了全部,数据说得很清楚:
   *    要补到 59g,**中位数得加到 1.8 倍**;1.3 倍以内够的只有 12%,
   *    1.6 倍以内 39%。而蔬菜为主的菜根本救不了(凉拌黄瓜要加 36 倍)。
   *    所以这里设了硬上限,加不动就交给 proteinTopUp。
   *
   * ⚠️ 上限是两条一起卡:
   *    倍数 ≤1.5 —— 再多就不是「多吃一点」,是换了道菜(比例也变了)
   *    绝对量 ≤ +120g —— 一顿吃 250g 以上的肉,对多数人是负担不是营养
   */
  var BOOST_MAX_MULT = 1.5;
  var BOOST_MAX_ADD = 120;
  var BOOST_MIN_PROTEIN_DENSITY = 10;   // 低于这个的不算蛋白源,加了也没用

  function portionBoost(variant, n, target) {
    if (!variant || !n || !target || !target.protein) return null;
    var gap = target.protein - n.protein;
    if (gap < 5) return null;

    // 挑蛋白密度最高的那个主料来加
    var best = null;
    (variant.ingredients || []).forEach(function (it) {
      if (it.role !== 'main' || !it.grams) return;
      var i = ing(it.ids[0]);
      if (!i || !i.per100g || !i.per100g.protein) return;
      if (i.per100g.protein < BOOST_MIN_PROTEIN_DENSITY) return;
      if (!best || i.per100g.protein > best.density) {
        best = { id: it.ids[0], name: it.names[0], from: it.grams,
                 density: i.per100g.protein, kcal100: i.per100g.kcal || 0 };
      }
    });
    if (!best) return null;

    var wanted = gap / best.density * 100;
    var add = Math.min(wanted, best.from * (BOOST_MAX_MULT - 1), BOOST_MAX_ADD);

    // ⚠️ 加量是有热量代价的,不能为了凑蛋白把一顿推成 1482 kcal ——
    //    那是减脂目标(832)的 1.8 倍。实测有 18% 的顿数越过了 25% 宽容带。
    //    肥牛卷 150→230g 加 15g 蛋白,同时加 300 kcal;这种就该少加或不加。
    if (target.kcal) {
      var room = target.kcal * 1.25 - n.kcal;
      if (room <= 0) return null;
      if (best.kcal100 > 0) add = Math.min(add, room / best.kcal100 * 100);
    }

    add = Math.round(add / 10) * 10;
    if (add < 20) return null;              // 加不到 20g 不值得改清单

    return {
      ingredientId: best.id, name: best.name,
      from: best.from, to: best.from + add, added: add,
      protein: Math.round(add * best.density / 100),
      kcal: Math.round(add * best.kcal100 / 100),
    };
  }

  /**
   * 蛋白不够就补一份 —— **和「不带主食就配碗饭」是同一套逻辑**。
   *
   * ⚠️ 为什么必须有这个:减脂目标算出来单顿要 59g 蛋白,
   *    而在一份典型配置下,293 个可做档位里能到 59g 的只有 7 个(2%),中位数 35g。
   *    也就是说**靠挑菜根本达不到** —— 就像当初 315 道菜不带主食,
   *    解法不是去挑「自带饭的菜」,是自动配一碗饭。
   *
   * ⚠️ 名单只收**字典里真有营养数据**的。即食鸡胸看着最合适(免做、100g/袋),
   *    但它的 per100g 是 null —— 用了就是我编数字,宁可不用。
   *
   * 排序按「每 100 kcal 能给多少蛋白」,减脂时这才是要紧的:
   *    金枪鱼罐头 25g/130kcal · 北豆腐 12.2g/116 · 鸡蛋 13g/144 · 希腊酸奶 9g/97
   */
  var PROTEIN_TOPUPS = [
    { id: 'canned_tuna', grams: 100, how: '开一罐沥干,拌进去或者摆边上' },
    { id: 'firm_tofu', grams: 150, how: '切块,煎两面或者直接凉拌' },
    { id: 'egg', grams: 50, how: '煮一个或者煎一个' },
    { id: 'greek_yogurt', grams: 150, how: '饭后一杯' },
  ];

  /**
   * 这一顿要不要补蛋白、补什么。
   * @param blacklist 忌口(补的东西也得守忌口,不然等于绕过设置)
   * @return {ingredientId, name, grams, protein, kcal, how} 或 null
   */
  /**
   * @param used 这一轮已经用过的补充项 {id:次数} —— **必须传**,否则四顿全是金枪鱼。
   *
   * ⚠️ 连着四顿加同一样东西,不管那样东西多合适都是坏结果:
   *    一是腻,二是你可能压根不爱吃它。轮换的成本几乎为零,不轮换的代价是整份计划废掉。
   */
  function proteinTopUp(n, target, blacklist, used) {
    if (!n || !target || !target.protein) return null;
    var gap = target.protein - n.protein;
    if (gap < 8) return null;                 // 差一点点不值得多买一样东西

    var bad = {};
    (blacklist || []).forEach(function (b) { bad[b] = 1; });
    var seen = used || {};

    // 用得最少的排前面;同样次数的保持原有顺序(蛋白密度高的优先)
    var order = PROTEIN_TOPUPS.map(function (t, i) { return { t: t, i: i }; })
      .sort(function (a, b) {
        var d = (seen[a.t.id] || 0) - (seen[b.t.id] || 0);
        return d !== 0 ? d : a.i - b.i;
      });

    for (var i = 0; i < order.length; i++) {
      var t = order[i].t;
      if (bad[t.id]) continue;
      var ig = ing(t.id);
      if (!ig || !ig.per100g || !ig.per100g.protein) continue;   // 没数据的不用
      // 按缺口算要多少,但不超过一个正常份量的两倍 —— 补蛋白不是硬灌
      var need = Math.min(t.grams * 2,
                          Math.max(t.grams, Math.round(gap / ig.per100g.protein * 100 / 10) * 10));
      return {
        ingredientId: t.id, name: ig.name, grams: need, how: t.how,
        protein: Math.round(need * ig.per100g.protein / 100),
        kcal: Math.round(need * (ig.per100g.kcal || 0) / 100),
      };
    }
    return null;
  }

  /** 离目标差多少 —— 0 = 达标 */
  function shortfall(n, target) {
    if (!target) return 0;
    function miss(actual, want) { return want ? Math.max(0, (want - actual) / want) : 0; }
    // 蛋白和蔬菜权重更高:热量少一点不要紧,蛋白不够是真问题
    var under = miss(n.kcal, target.kcal) * 0.5
              + miss(n.protein, target.protein) * 1.0
              + miss(n.veg, target.veg) * 0.7;

    // ⚠️ 超标也得罚。第一版只算「不够」,于是红烧肉那顿 1581 kcal(目标 700)
    //    在分数上和刚好达标一模一样 —— 一个减脂目标的人排出两倍热量的一顿,
    //    系统一声不吭,还可能再给它配盘青菜。
    //    给 25% 的宽容带(一顿吃多点很正常),超过才开始算。
    //
    // ⚠️ 但这一项**治不了本**。实测把权重从 0.6 加到 3.0,超宽容带的顿数
    //    只从 18% 降到 11%,浪费反而从 20% 涨到 22% —— 因为超标的不是
    //    「加多了」,是**那道菜本身就那么高**(越式炸春卷 1234 kcal、
    //    肉じゃが 1263)。打分只能在候选之间挑,挑不出库里没有的东西。
    //    取 1.5:有改善、代价小。真要解决得靠份量(菜谱克数按目标缩放),
    //    那是另一件事,记在 PROGRESS.md 里。
    var over = 0;
    if (target.kcal && n.kcal > target.kcal * 1.25) {
      over = (n.kcal - target.kcal * 1.25) / target.kcal;
    }
    return under + over * 1.5;
  }

  return {
    DEFAULT_STAPLE: DEFAULT_STAPLE, STAPLE_GRAMS: STAPLE_GRAMS,
    gramsOf: gramsOf, ofVariant: ofVariant, ofMeal: ofMeal, shortfall: shortfall,
    PROTEIN_TOPUPS: PROTEIN_TOPUPS, proteinTopUp: proteinTopUp,
    portionBoost: portionBoost,
  };
})();

if (typeof module !== 'undefined') module.exports = Nutrition;
