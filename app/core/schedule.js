// 把选出来的菜排到第几天第几顿 —— 纯函数,不碰 DOM。
//
// 为什么必须有这一层:求解器只回答「买什么、做哪几道」,**不回答什么时候做**。
// 早先四道菜就是数组顺序 1/2/3/4,那是它们被挑中的顺序,不是该吃的顺序。
//
// 这不是排版问题,是会坏事的:
//   DESIGN 第四节写着 fresh 是「周末两天内清零」的硬约束,
//   Round.freshnessNote 也早就在提示「鲜鱼鲜虾只能排头两天」——
//   可是没有任何一行代码把这条落到**具体某顿**。
//   于是你可能按 1234 的顺序做,第四天才吃那条冷藏保质期 1 天的鱼。
//
// 规则只有一条,而且完全由数据推出来:**最容易坏的先吃**。

var Schedule = (function () {

  /** 这道菜里最短的保质期是多少天 —— 决定它必须多早吃掉。
   *
   * ⚠️ 判据是**保质期本身,不是 tier**。
   *    第一版写的是 `tier === 'fresh'`,漏掉了虾仁:它 tier=buffer(可冷冻),
   *    但字典里 shelfLifeDays=1 —— 买回来鲜的就是只能放一天。
   *    于是「滑蛋虾仁」被判成「不怕放」排到最后一天。
   *    tier 说的是「能不能囤」,保质期说的是「放得了几天」,这两件事不是一回事。
   *
   *    staple(米面油调料)不算:它们不是这次买的,也不构成时间压力。 */
  function perishability(recipeId, prepLevel) {
    var rec = RECIPES.filter(function (x) { return x.id === recipeId; })[0];
    if (!rec) return { days: null, driver: null };
    var v = (rec.variants || []).filter(function (x) { return x.prepLevel === prepLevel; })[0]
            || (rec.variants || [])[0];
    if (!v) return { days: null, driver: null };

    var best = null, driver = null;
    (v.ingredients || []).forEach(function (it) {
      // 「或」组:按最耐放的那个算 —— 你会挑能放的那样买
      var cand = null, candIng = null;
      it.ids.forEach(function (id) {
        var ing = INGREDIENTS.filter(function (x) { return x.id === id; })[0];
        if (!ing || ing.tier === 'staple' || !ing.shelfLifeDays) return;
        if (cand === null || ing.shelfLifeDays > cand) { cand = ing.shelfLifeDays; candIng = ing; }
      });
      if (cand === null) return;
      if (best === null || cand < best) { best = cand; driver = candIng; }
    });
    return { days: best, driver: driver ? driver.name : null };
  }

  /**
   * 排期。
   * @param meals  [{recipeId, prepLevel, ...}]
   * @param days   几天
   * @param perDay 每天几顿
   * @return [{day, slot, meal, urgent, reason}]  按该做的顺序
   *
   * ⚠️ 返回新数组,**不改传进来的 meals**,也不写回存储。
   *    排期是能从保质期算出来的派生数据 —— 存一份下来,
   *    以后改了保质期或者换了菜,那份就成了对不上的旧账。
   */
  function assign(meals, days, perDay) {
    var n = Math.max(1, days || 1);
    var per = Math.max(1, perDay || 1);

    var withP = (meals || []).map(function (m, i) {
      var p = perishability(m.recipeId, m.prepLevel);
      return { meal: m, i: i, days: p.days, driver: p.driver };
    });

    // 最容易坏的排前面。没有 fresh 食材的(全冷冻/全干货)排最后 —— 它们等得起。
    withP.sort(function (a, b) {
      var da = a.days == null ? 9999 : a.days;
      var db = b.days == null ? 9999 : b.days;
      if (da !== db) return da - db;
      return a.i - b.i;                      // 同档保持求解器给的顺序,不引入随机
    });

    return withP.map(function (x, idx) {
      var day = Math.min(n, Math.floor(idx / per) + 1);
      // 「这道菜的食材撑不到你打算做它那天」—— 这才是要警告的事
      var urgent = x.days != null && x.days < day;
      return {
        day: day,
        slot: (idx % per) + 1,
        meal: x.meal,
        shelfLifeDays: x.days,
        driver: x.driver,
        urgent: urgent,
        reason: x.driver
          ? x.driver + ' 冷藏约 ' + x.days + ' 天'
          : '没有容易坏的食材,放到最后做',
      };
    });
  }

  /** 整体上有没有排不下的 —— 给页面一句总结,而不是让人自己看四张卡片对比 */
  function warnings(plan) {
    return plan.filter(function (p) { return p.urgent; }).map(function (p) {
      return p.meal.name + ' 里的 ' + p.driver + ' 冷藏只有 ' + p.shelfLifeDays +
             ' 天,排在第 ' + p.day + ' 天多半已经不新鲜了 —— 提前做,或者那天换个冷冻的。';
    });
  }

  return { assign: assign, warnings: warnings, perishability: perishability };
})();

if (typeof module !== 'undefined') module.exports = Schedule;
