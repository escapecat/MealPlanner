// 「哪些包装规格值得你去核实」—— 纯函数,不碰 DOM。
//
// 背景:135 条包装规格里 A 级(核对过)只有 1 条,其余全是估计值。
// 让用户去核实 135 条不现实,但也不能假装那些数字是准的。
//
// 出路是**排优先级**:一条规格的影响力 = 它被用到的频率 × 它造成的剩余量。
// 黄瓜 500g/包而一道菜用 90g —— 这条错 20% 会显著改变采购建议;
// 八角 30g/包一次用 2g —— 这条错一倍也无所谓,反正都是「买一包放很久」。
//
// 12 周模拟的诊断证实了这个方向:扔掉的东西 90% 集中在少数几样配菜身上
// (芹菜 90% · 绿豆芽 86% · 竹笋 80% · 黄瓜 73%),而主料只扔 16-25%。
// 所以「先核实这 8 条」是可行的,「核实 135 条」不是。

var SpecPriority = (function () {

  function ing(id) {
    return INGREDIENTS.filter(function (i) { return i.id === id; })[0] || null;
  }

  /**
   * 扫全库,算每个食材的「规格影响力」。
   * @param cfg 用户的约束(只统计他做得了的菜)
   */
  function unitOf(o) { return o.unit === 'ml' ? 'ml' : 'g'; }

  function rank(cfg, limit) {
    var use = {};      // id -> {dishes, grams[]}
    RECIPES.forEach(function (r) {
      if (r.type === 'prep') return;
      var vs = Catalog.availableVariants(r, cfg || {});
      if (!vs.length) return;
      vs[0].ingredients.forEach(function (x) {
        if (x.role !== 'main' && x.role !== 'side') return;
        var id = x.ids[0];
        var g = Nutrition.gramsOf(x);
        if (g == null) return;
        var u = (use[id] = use[id] || { dishes: 0, grams: [] });
        u.dishes++;
        u.grams.push(g);
      });
    });

    var out = [];
    Object.keys(use).forEach(function (id) {
      var i = ing(id);
      if (!i || i.tier === 'staple') return;      // 调料买一次放很久,规格准不准无所谓
      var opt = Packaging.smallest(id);
      if (!opt) return;
      var u = use[id];
      var avg = u.grams.reduce(function (a, b) { return a + b; }, 0) / u.grams.length;
      // 一道菜用不完一包时,剩下的比例就是这条规格的「杀伤力」
      var leftoverRatio = Math.max(0, (opt.netWeight - avg) / opt.netWeight);
      // 影响力 = 出现频率 × 单次剩余比例 × 会不会烂(fresh 才真扔)
      var perish = i.tier === 'fresh' ? 1 : 0.3;
      var impact = u.dishes * leftoverRatio * perish;
      out.push({
        id: id, name: i.name, tier: i.tier,
        dishes: u.dishes, avgUse: Math.round(avg),
        packSize: opt.netWeight, unit: opt.unit,
        source: opt.source, confidence: opt.confidence,
        leftoverRatio: leftoverRatio, impact: impact,
        shelfLifeDays: i.shelfLifeDays,
        why: leftoverRatio > 0.6
          ? '一道菜只用 ' + Math.round(avg) + unitOf(opt) + ',一包 ' + opt.netWeight + unitOf(opt) +
            ' —— 剩下的 ' + Math.round(leftoverRatio * 100) + '% 很可能烂掉'
          : '出现在 ' + u.dishes + ' 道菜里,规格错了会连带算错很多次',
      });
    });

    return out
      .filter(function (x) { return x.confidence !== 'A'; })   // 已核实的不用再看
      .sort(function (a, b) { return b.impact - a.impact; })
      .slice(0, limit || 10);
  }

  return { rank: rank };
})();

if (typeof module !== 'undefined') module.exports = SpecPriority;
