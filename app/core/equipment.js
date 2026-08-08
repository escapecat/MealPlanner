// 厨具替代矩阵 —— 纯函数,不碰 DOM。
//
// 为什么放在这里而不是写进每道菜的「厨具可替代」列:
// 这条规则是**系统性的**(哪口锅能顶哪口锅,取决于做法),不是每道菜各自的特殊情况。
// 写进菜谱要改 300+ 行,而且下次加菜的人还得重记一遍;放在这里改一处全库生效。
//
// 菜谱里的 equipmentAlt 保留,它表达的是**这道菜特有的**替代(某道菜注明烤箱可换空气炸锅
// 但要减温减时)。两者叠加使用:先看菜自己的,再看这张通用表。
//
// ⚠️ 这张表是烹饪常识判断,没有实测。每条都写了限制条件,不是无脑等价。

var Equipment = (function () {

  // need: 菜谱要求的锅   by: 可以顶替的锅   methods: 只在这些做法下成立
  var SUBS = {
    '炒锅': [
      { by: '不粘锅', methods: ['炒', '煎', '煸', '焖', '烧', '煮', '蒸', '拌', '凉拌'],
        note: '不粘锅火别开太大(涂层怕高温),一次别炒太多容易出水' },
      { by: '汤锅', methods: ['煮', '炖', '焖', '蒸', '炸', '烧', '拌', '凉拌', '焖饭'],
        note: '汤锅炒不了,但煮炖焖没问题;炸要够深' },
      { by: '砂锅', methods: ['炖', '焖', '煮', '烧'],
        note: '砂锅升温慢但保温好,炖菜更合适' },
      // ⚠️ **不含「炒」和「煎」** —— 电饭煲上不了那个火力,给顶就是骗人。
      //    但很多菜点名要炒锅只是拿它当盛水的锅(蒸蛋要「炒锅+蒸架」),
      //    那种场合电饭煲完全够用。
      { by: '电饭煲', methods: ['蒸', '煮', '炖', '焖', '焖饭'],
        note: '电饭煲炒不了菜,但蒸煮炖没问题;中途加料和收汁不方便' },
    ],
    '汤锅': [
      { by: '炒锅', methods: ['煮', '炖', '焖', '烧', '白灼', '拌', '凉拌', '蒸', '炸'],
        note: '中式家庭本来就常用炒锅煮汤,深炒锅足够' },
      { by: '不粘锅', methods: ['煮', '煎', '拌', '凉拌', '白灼'],
        note: '不粘锅通常较浅,煮的量别太多' },
      { by: '砂锅', methods: ['煮', '炖', '焖'], note: '' },
      { by: '电压力锅', methods: ['炖', '煮'], note: '省时间,但收汁和火候控制不了' },
      { by: '电饭煲', methods: ['煮', '炖', '蒸'],
        note: '现在的电饭煲多半有「煲汤」模式;容量比汤锅小,而且中途加料不方便' },
    ],
    '不粘锅': [
      // ⚠️ 「煎」必须在这个列表里 —— 中式厨房用炒锅煎了几百年。
      //    第一版把它漏了,导致「只有炒锅」的人一道煎菜都做不了,而备注里却写着煎的注意事项,
      //    表和它自己的说明打架。加限制条件可以,直接禁掉不行。
      { by: '炒锅', methods: ['炒', '煎', '煮', '煸', '焖', '炖', '烧', '拌', '凉拌', '烙', '蒸'],
        note: '炒锅能顶,但**煎鱼煎蛋容易粘** —— 热锅凉油,或者多放一点油' },
      { by: '汤锅', methods: ['煮', '炖', '拌', '凉拌'], note: '' },
    ],
    // ⚠️ 蒸架第一版**整条都没有** —— 45 道菜要它,却没写谁能顶。
    //    而「蒸」这件事最不挑锅:汤锅架个盘子、炒锅放个碗、电饭煲自带蒸格,
    //    家里但凡有个带盖的锅都能蒸。45 道里 39 道就是「蒸」。
    '蒸架': [
      { by: '汤锅', methods: ['蒸', '炖', '煮'],
        note: '锅底放水、架个倒扣的碗或盘子垫高就行,盖子留条缝防溢' },
      { by: '炒锅', methods: ['蒸', '炖', '煮'],
        note: '深炒锅加盖一样能蒸,注意水别烧干' },
      { by: '电饭煲', methods: ['蒸', '炖', '煮'],
        note: '多数电饭煲带蒸格,或者用「煮饭」模式隔水蒸;容量小,一次蒸不了太多' },
      { by: '电压力锅', methods: ['蒸', '炖'],
        note: '快得多,但蒸鱼蒸蛋这类嫩的容易过火' },
    ],

    // ⚠️ 现在的电饭煲基本都有「煲汤 / 蒸煮」模式,不再只是煮饭的。
    //    库里 22 道点名要它,其中 11 道是焖饭 —— 那个确实只有它最省事;
    //    但反过来,它能顶汤锅炖汤、顶蒸架蒸菜,这两条以前一条都没写。
    '电饭煲': [
      { by: '汤锅', methods: ['焖饭', '煮', '炖', '蒸'],
        note: '焖饭要小火盯着、最后焖十分钟,不像电饭煲能走开' },
      { by: '砂锅', methods: ['焖饭', '煮', '炖'],
        note: '砂锅焖饭更香,但更容易糊底' },
      { by: '电压力锅', methods: ['焖饭', '煮', '炖'], note: '' },
    ],

    // ⚠️ 电压力锅也是**整条没写**(和蒸架一样的漏)。8 道菜点名要它,
    //    可它本质是**省时间的工具,不是必需品** —— 炖焖煮用普通锅都能干,只是慢。
    //
    // ⚠️⚠️ 但这条替代有个别处没有的副作用:**库里的时间是按压力锅估的**。
    //     土豆排骨汤标 120 分钟,那是压力锅的数;拿汤锅炖得两小时往上。
    //     替代之后「多久能吃上」会偏乐观,而那个数字正被「最多能等多久」当约束用。
    //     我没有伪造一个倍数去修正它 —— 那个倍数我编不出来。
    //     现在的做法是在 note 里说清楚,并记进 PROGRESS.md。
    '电压力锅': [
      { by: '汤锅', methods: ['炖', '焖', '煮'],
        note: '⚠️ 能做,但**时间要长得多** —— 库里标的分钟数是按压力锅算的,' +
              '普通锅炖这类硬货通常要 1.5-2 倍以上,水也要多加' },
      { by: '砂锅', methods: ['炖', '焖', '煮'],
        note: '⚠️ 同上,砂锅更慢但更香;库里的时间是压力锅的数' },
      { by: '电饭煲', methods: ['炖', '煮'],
        note: '⚠️ 有「煲汤」模式的可以,时间比压力锅长;骨头这类硬货未必炖得烂' },
      { by: '炒锅', methods: ['炖', '焖'],
        note: '⚠️ 深炒锅加盖也行,但水分蒸发快,中途要补水;时间比压力锅长得多' },
    ],

    // 烤箱/空气炸锅这一对菜谱里已经逐道标了 equipmentAlt,这里补一条兜底
    '烤箱': [
      { by: '空气炸锅', methods: ['烤', '空炸', '烘'],
        note: '⚠️ 不是等价替代 —— 空气炸锅要**降 20℃、减 1/3 时间**,而且容量小,烘焙类未必行' },
    ],
    '空气炸锅': [
      { by: '烤箱', methods: ['空炸', '烤', '烘'], note: '烤箱要升温预热,时间更长' },
    ],
  };

  /**
   * 手上这些锅,能不能满足这道菜要的某一件厨具。
   * 返回 {ok, direct, via, note} —— via/note 用来在 UI 上说明「你是拿什么顶的、要注意什么」。
   */
  function satisfy(need, owned, method) {
    var have = {};
    (owned || []).forEach(function (e) { have[e] = true; });
    if (have[need]) return { ok: true, direct: true };

    var rules = SUBS[need] || [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (!have[r.by]) continue;
      if (method && r.methods.indexOf(method) < 0) continue;
      return { ok: true, direct: false, via: r.by, note: r.note, need: need };
    }
    return { ok: false, need: need };
  }

  /** 整道菜的厨具需求能不能满足;返回所有用到的替代,供 UI 提示 */
  function check(recipe, owned, extraRequired) {
    var need = (extraRequired || recipe.equipmentRequired || []);
    var subs = [];
    for (var i = 0; i < need.length; i++) {
      var n = need[i];
      // 先看这道菜自己标的可替代组(菜谱级,优先),再看通用表
      var ownedSet = {};
      (owned || []).forEach(function (e) { ownedSet[e] = true; });
      var byRecipe = (recipe.equipmentAlt || []).some(function (g) {
        return g.indexOf(n) >= 0 && g.some(function (x) { return ownedSet[x]; });
      });
      if (ownedSet[n] || byRecipe) continue;

      var s = satisfy(n, owned, recipe.method);
      if (!s.ok) return { ok: false, missing: n, subs: subs };
      subs.push(s);
    }
    return { ok: true, subs: subs };
  }

  /** 「爆炒必须有炒锅」这类没有替代的组合,列出来给 UI 解释 */
  function hardRequirements() {
    return [
      { equipment: '炒锅', methods: ['爆', '炸'],
        why: '爆炒要 200℃ 以上的锅气,不粘锅涂层扛不住,直边汤锅也颠不起来' },
    ];
  }

  return { SUBS: SUBS, satisfy: satisfy, check: check, hardRequirements: hardRequirements };
})();

if (typeof module !== 'undefined') module.exports = Equipment;
