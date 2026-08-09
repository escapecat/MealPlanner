// 统计 —— 纯函数,不碰 DOM。
//
// ⚠️ FEATURES 第 26 条两条铁律,这个文件整个是照着它写的:
//      1. 数据必须**被动落下** —— 除了打分,全部来自你本来就会做的操作
//      2. **每个指标背后要能接一个动作** —— 接不上动作的是虚荣指标
//         (「累计做了 47 道菜」看两次就腻),不做
//
// ⚠️ 第 28 条:洞察用**诊断式**,不用颁奖式。
//    「你这周做了 4 顿,真棒!」→ 没用。
//    「排了 8 顿做了 3 顿 —— 下次少排点?」→ 能接动作。
//
// ⚠️ 最大的陷阱是**样本量**。一两轮数据什么都证明不了,可它照样能算出
//    一个「叶菜浪费 100%」的漂亮数字。第 27 条说的「冷启动别给空页面」
//    不等于「冷启动可以给假结论」—— 所以每条洞察都自带 ready/need,
//    不够就老实说还差几轮,绝不先给个数再补一句「样本较少」。

var Stats = (function () {

  /** 一条洞察的形状:
   *  {id, ready, need, have, title, detail, action}
   *  ready=false 时只显示「再攒 N 轮解锁」,**不给数字** —— 半成品的结论比没有更糟。 */

  function rounds() { return Store.get('rounds', []) || []; }
  function finished() {
    return rounds().filter(function (r) {
      return r.status === 'done' || r.status === 'skipped';
    });
  }

  /** 所有评分摊平:[{recipeId, name, like, fill, time, round}] */
  function allRatings() {
    var out = [];
    rounds().forEach(function (r) {
      var rt = (r.log || {}).ratings || {};
      ((r.solved || {}).meals || []).forEach(function (m) {
        var v = rt[m.recipeId];
        if (!v) return;
        out.push({ recipeId: m.recipeId, name: m.name, like: v.like,
                   fill: v.fill, time: v.time, round: r.id });
      });
    });
    return out;
  }

  // ---------------- 诊断 ----------------

  /**
   * 执行率 —— **最重要的一个**(FEATURES 第 25 条)。
   * 它直接对着「一时热度」这个风险:系统不该在你只做 2 顿时还固执地排 4 顿,
   * 让你每周都欠一笔。
   */
  function completion() {
    var done = finished().filter(function (r) { return r.solved; });
    var NEED = 2;
    if (done.length < NEED) {
      return { id: 'completion', ready: false, need: NEED, have: done.length,
               title: '排了几顿 · 做了几顿' };
    }
    var planned = 0, cooked = 0;
    done.forEach(function (r) {
      planned += (r.solved.meals || []).length;
      cooked += (r.solved.meals || []).filter(function (m) { return m.cooked; }).length;
    });
    var rate = planned ? cooked / planned : 0;
    var pct = Math.round(rate * 100);
    var o = { id: 'completion', ready: true, title: '排了几顿 · 做了几顿',
              detail: planned + ' 顿里做了 ' + cooked + ' 顿(' + pct + '%)' };
    // ⚠️ 有动作才说话。80% 以上就是正常波动,不用提醒。
    if (rate < 0.6) {
      o.action = '连着排不完 —— 下次少排一天试试,排 4 顿做 4 顿比排 8 顿做 3 顿好受。';
      o.level = 'warn';
    }
    return o;
  }

  /**
   * 什么东西总是剩下 —— 直接对着「买回来烂掉」。
   * ⚠️ 只认 wasteLog(你亲手点的),不拿「买了多少减用了多少」估 ——
   *    那个差额里混着「还在冰箱里好好放着」,当成浪费就是冤枉人。
   *
   * ⚠️ 同一份日志里现在有三种 kind,**只有 waste 算浪费**:
   *      eaten   吃掉了   → 只进分母
   *      waste   扔了     → 分子 + 分母
   *      mistake 记错了   → **两头都不进**(那条记录本来就不该存在,
   *                         不是「买了没吃」,是「压根没买」)
   *    老数据没有 kind:那时候这份日志只记浪费,一律按 waste 算。
   */
  function wasted() {
    var all = Store.get('wasteLog', []) || [];
    function isWaste(w) { return !w.kind || w.kind === 'waste'; }
    var thrown = all.filter(isWaste);
    var eaten = all.filter(function (w) { return w.kind === 'eaten'; });
    var NEED = 5;
    if (thrown.length < NEED) {
      return { id: 'wasted', ready: false, need: NEED, have: thrown.length,
               title: '什么东西总是剩' };
    }
    var by = {};
    thrown.forEach(function (w) {
      var k = w.ingredientId || w.name;
      // ⚠️ 名字兜底要走字典,不能只信日志里那个字段:老版本的 logWaste
      //    **根本没记 name**,只有 ingredientId —— 于是这儿会印出
      //    「spinach 3 次」,英文 id 直接漏到界面上(和「scratch:太辣」同一类)。
      var nm = w.name;
      if (!nm && typeof Catalog !== 'undefined' && Catalog.ingredient) {
        var i = Catalog.ingredient(k);
        if (i) nm = i.name;
      }
      (by[k] = by[k] || { id: k, name: nm || k, grams: 0, times: 0 });
      if (nm) by[k].name = nm;
      by[k].grams += w.grams || 0;
      by[k].times++;
    });
    var top = Object.keys(by).map(function (k) { return by[k]; })
      .sort(function (a, b) { return b.times - a.times || b.grams - a.grams; })
      .slice(0, 3);
    var detail = top.map(function (x) {
      return x.name + ' ' + x.times + ' 次' +
             (x.grams ? '(共 ' + Math.round(x.grams) + 'g)' : '');
    }).join(' · ');
    // ⚠️ 有「吃完了」垫底才给得出浪费率。**没有分母的比例是编的** ——
    //    只数扔掉的次数永远算不出「扔了多少」,只能算出「扔过几回」。
    function sum(a) { return a.reduce(function (s, w) { return s + (w.grams || 0); }, 0); }
    var eatenG = sum(eaten), wasteG = sum(thrown);
    if (eatenG > 0) {
      detail += ' · 记下来的里面 ' +
                Math.round(wasteG / (eatenG + wasteG) * 100) + '% 是扔掉的';
    }
    var o = { id: 'wasted', ready: true, title: '什么东西总是剩', detail: detail };
    if (top[0] && top[0].times >= 3) {
      o.action = '「' + top[0].name + '」反复扔 —— 加进忌口,或者在采购清单上把它的规格改小。';
      o.level = 'warn';
    }
    return o;
  }

  /**
   * 口味:哪些标了「不想再做」。
   * ⚠️ 接的动作很实:一键加进排除清单,下次不再排。
   *    不做「你偏爱粤菜」这种画像 —— 那接不上任何动作,是虚荣指标。
   */
  function disliked() {
    var rs = allRatings();
    var NEED = 6;
    if (rs.length < NEED) {
      return { id: 'disliked', ready: false, need: NEED, have: rs.length,
               title: '哪几道你不想再做' };
    }
    var bad = {};
    rs.forEach(function (x) {
      if (x.like !== 'bad') return;
      (bad[x.recipeId] = bad[x.recipeId] || { recipeId: x.recipeId, name: x.name, n: 0 }).n++;
    });
    var list = Object.keys(bad).map(function (k) { return bad[k]; })
      .sort(function (a, b) { return b.n - a.n; });
    if (!list.length) {
      return { id: 'disliked', ready: true, title: '哪几道你不想再做',
               detail: '还没有标过「不想再做」的' };
    }
    return { id: 'disliked', ready: true, title: '哪几道你不想再做',
             detail: list.map(function (x) { return x.name; }).join(' · '),
             action: '把这几道排除掉,以后不再出现。',
             actionKind: 'exclude', payload: list.map(function (x) { return x.recipeId; }) };
  }

  /**
   * 份量对不对 —— 只调**构成**,不调总量。
   * ⚠️ FEATURES 第 19 条:饭量不能靠反馈学。减脂目标下「不够吃」是常态,
   *    照着它加总热量的话,目标会一路往上漂,减脂就白做了。
   *    所以这里给的动作是「加蔬菜/加蛋白」,**不是「把目标调高」**。
   */
  function portion() {
    var rs = allRatings().filter(function (x) { return x.fill; });
    var NEED = 6;
    if (rs.length < NEED) {
      return { id: 'portion', ready: false, need: NEED, have: rs.length, title: '份量对不对' };
    }
    var more = rs.filter(function (x) { return x.fill === 'more'; }).length;
    var less = rs.filter(function (x) { return x.fill === 'less'; }).length;
    var o = { id: 'portion', ready: true, title: '份量对不对',
              detail: rs.length + ' 顿里 ' + more + ' 顿不够吃 · ' + less + ' 顿吃不完' };
    if (more / rs.length > 0.4) {
      o.action = '多半是**不顶饿**,不是热量不够 —— 先加蔬菜和蛋白的比例,别急着调高目标。';
      o.level = 'warn';
    } else if (less / rs.length > 0.4) {
      o.action = '经常吃不完 —— 份量可以往下调,剩下的也别硬吃。';
    }
    return o;
  }

  /**
   * 时间估得准不准 —— 这条直接接回求解器的耗时上限。
   * ⚠️ 问的是**相对**(比说的快/慢),因为绝对耗时测不到:
   *    cookedAt 只有做完的时刻,没有开始。见 rounds.js 的反馈那段。
   */
  function timing() {
    var rs = allRatings().filter(function (x) { return x.time; });
    var NEED = 6;
    if (rs.length < NEED) {
      return { id: 'timing', ready: false, need: NEED, have: rs.length, title: '时间估得准不准' };
    }
    var slow = rs.filter(function (x) { return x.time === 'slow'; }).length;
    var o = { id: 'timing', ready: true, title: '时间估得准不准',
              detail: rs.length + ' 顿里 ' + slow + ' 顿比说的久' };
    if (slow / rs.length > 0.4) {
      o.action = '库里的时间**系统性偏乐观** —— 把「单顿动手上限」调低一点,' +
                 '排出来的才是你真做得完的。';
      o.level = 'warn';
    }
    return o;
  }

  /** 全部洞察,没准备好的排在后面 */
  function all() {
    var list = [completion(), wasted(), disliked(), portion(), timing()];
    return list.sort(function (a, b) {
      if (a.ready !== b.ready) return a.ready ? -1 : 1;
      // 能接动作的排前面 —— 接不上动作的本来就不该占位置
      return (b.action ? 1 : 0) - (a.action ? 1 : 0);
    });
  }

  return { all: all, allRatings: allRatings,
           completion: completion, wasted: wasted, disliked: disliked,
           portion: portion, timing: timing };
})();

if (typeof module !== 'undefined') module.exports = Stats;
