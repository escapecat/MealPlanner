// 一顿饭完不完整 —— 纯函数,不碰 DOM。
//
// ⚠️ 这一层是补一个模型上的错:求解器原来的假设是「**一道菜 = 一顿饭**」。
//    可库里 512 道菜有 85 道(17%)蛋白低于 20g —— 宁式烤菜(上海青 400g,
//    蛋白 18g)按这个模型可以名正言顺地当一顿晚饭。
//    加打分权重只是让它不容易被选中,没从根上排除。
//
// 真实的一顿是两种形态之一:
//   A. **一锅端** —— 牛肉滑蛋包菜焖饭那种,蛋白/蔬菜/主食全在里面
//   B. **主菜 + 烫青菜** —— 主菜负责蛋白,青菜烫一下(五分钟,不是再炒一个菜)
//
// 所以规则是:**主菜位只认蛋白达标的菜**;蔬菜不够就配一份烫的;没主食就配碗饭。
// 配菜刻意不从菜谱库里选 —— 选出来的会是「另一道要动手做的菜」,
// 而你要的是「烫一下」。烫青菜是生成的,不是挑的。

var Meal = (function () {

  // 主菜的蛋白门槛。取单顿目标的 6 成 —— 不是「必须吃够」,是「不能几乎没有」。
  // 目标算不出来时兜底 22g:一个鸡蛋 7g、100g 鸡胸 22g,低于这个数就不像一顿正餐。
  function proteinFloor(target) {
    return target && target.protein ? Math.round(target.protein * 0.6) : 22;
  }

  // 蔬菜门槛低一些 —— 少一点无所谓,一点没有才是问题
  function vegFloor(target) {
    return target && target.veg ? Math.round(target.veg * 0.5) : 120;
  }

  /** 这道菜能不能独当一顿(即:够不够格占主菜位) */
  function canBeMain(nutrition, target) {
    if (!nutrition) return true;                 // 算不出来就不拦,不凭空否决
    return nutrition.protein >= proteinFloor(target);
  }

  /** 还缺不缺青菜。
   *
   * ⚠️ 两个条件都要满足,不能只看蔬菜少。
   *    配菜不是白来的:它要么吃掉剩料(好),要么**为了 200g 菜开一整包**(浪费),
   *    而且不管哪种都会往这顿里再加 100-200 kcal(可能吃撑)。
   *    所以热量已经顶到目标的菜不再配 —— 红烧肉那顿 1581 kcal,
   *    再给它配一盘蒜蓉西兰花是帮倒忙。 */
  function needsGreens(nutrition, target) {
    if (!nutrition) return false;
    if (nutrition.veg >= vegFloor(target)) return false;
    var kcalCap = target && target.kcal ? target.kcal * 1.15 : 900;
    return nutrition.kcal < kcalCap;
  }

  /** 一份烫青菜多少克 —— 补到门槛就行,不硬凑 */
  function greensGrams(nutrition, target) {
    var want = vegFloor(target) - (nutrition ? nutrition.veg : 0);
    return Math.max(100, Math.min(250, Math.round(want / 10) * 10));
  }

  /** 配菜必须**够简单** —— 你要的是「再弄个青菜」,不是再做一道菜。
   *  库里符合这三条的有 30 道:蒜蓉西兰花 · 手撕包菜 · 白灼上海青 · 凉拌黄瓜 ·
   *  蒸南瓜 · 空炸杂烤蔬菜……做法本身是有变化的,不该写死成「烫一下」。 */
  var SIDE_MAX_ACTIVE = 12;
  var SIDE_MAX_DIFFICULTY = 2;

  function isSimpleSide(variant, nutrition, target) {
    if (!variant || !nutrition) return false;
    if (variant.activeMinutes > SIDE_MAX_ACTIVE) return false;
    if (variant.difficulty > SIDE_MAX_DIFFICULTY) return false;
    if ((variant.potsUsed || 1) > 1) return false;
    if (nutrition.veg < 100) return false;
    // 蛋白高的不该当配菜 —— 那是另一道主菜,会把一顿变成两道正经菜
    return nutrition.protein < proteinFloor(target);
  }

  /**
   * 给一顿配一道简单青菜。
   *
   * ⚠️ 优先挑**能吃掉剩料**的那道 —— 12 周模拟显示扔掉的东西 90% 是配菜
   *    (芹菜扔 90%、绿豆芽 86%、竹笋 80%)。配青菜正好是消化这些剩料的地方,
   *    让「补齐蔬菜」和「少浪费」变成同一件事,而不是互相打架。
   *
   * @param pool      候选(全库,按配置筛过)
   * @param leftGrams {ingredientId: 还剩多少克}
   * @param used      {recipeId: 1} 已经用过的菜,不重复
   * @param wasteOf   (ingredientId, 要用多少克) → 为它开包会剩多少克。
   *                  ⚠️ 没有这个,配菜就只会挑「做起来快的」,不管它是不是
   *                     为了 200g 黄瓜开一整根。实测加配菜后浪费从 42% 涨到 48%,
   *                     全是这么涨的。主菜那边早就按边际浪费打分了,配菜也得按。
   */
  function pickSide(pool, leftGrams, target, used, wasteOf) {
    // ⚠️ 初始分必须是 -Infinity,不能是 -1。
    //    不吃剩料的配菜得分是负数(0*10 - activeMinutes),用 -1 起步的话
    //    它们永远选不上 —— 实测 858 次调用有 549 次返回 null,
    //    表现出来就是「蔬菜只有 30g 的那顿死活配不上青菜」。
    var best = null, bestScore = -Infinity, bestHelps = 0;
    (pool || []).forEach(function (c) {
      if (used && used[c.recipe.id]) return;
      if (!isSimpleSide(c.variant, c.nutrition, target)) return;

      // 这道配菜能吃掉多少还剩着的东西 / 又要为它新开多少包
      var helps = 0, newWaste = 0;
      (c.variant.ingredients || []).forEach(function (it) {
        if (it.role !== 'main' && it.role !== 'side') return;
        var id = it.ids[0];
        var have = (leftGrams || {})[id] || 0;
        if (have > 0 && it.grams) helps += Math.min(have, it.grams);
        else if (wasteOf && it.grams) newWaste += wasteOf(id, it.grams) || 0;
      });

      // 吃剩料加分,开新包扣分,做得久小扣
      var score = helps * 10 - newWaste * 2 - c.variant.activeMinutes;
      if (score > bestScore) { bestScore = score; best = c; bestHelps = helps; }
    });
    if (!best) return null;
    return {
      recipeId: best.recipe.id, name: best.recipe.name,
      method: best.recipe.method,
      activeMinutes: best.variant.activeMinutes,
      prepLevel: best.variant.prepLevel,
      veg: best.nutrition.veg,
      usesLeftover: bestHelps > 0,
      _cand: best,
    };
  }

  return {
    proteinFloor: proteinFloor, vegFloor: vegFloor,
    canBeMain: canBeMain, needsGreens: needsGreens, greensGrams: greensGrams,
    isSimpleSide: isSimpleSide, pickSide: pickSide,
  };
})();

if (typeof module !== 'undefined') module.exports = Meal;
