// Round —— 一次做饭/采购的完整记录。这是整个应用的核心实体。
//
// 为什么要有它:统计需要落点。「排了 4 顿实际做了 2 顿」「菠菜连续 3 周剩一半」
// 「实际耗时比标注长 62%」—— 这些都不是当前状态,是**跨多次记录**才看得出的东西。
// 只存一个「本周计划」的话,上周的数据就没了,诊断式统计全部无从谈起。
//
// 配置的三层结构(DESIGN.md 第七节):
//   Profile(长期,冷启动填)  ─┐
//   Round.overrides(这一次) ─┼─→ 求解器实际用的约束
//   系统学到的(执行率等)    ─┘
// overrides 只存**跟默认不一样的那几项**,不是整份配置拷贝 —— 这样以后改了长期设定,
// 历史 round 不会被追溯篡改,但也不会僵在一份过期的快照上。

var Round = (function () {

  var STATUS = {
    planning: '待生成',
    shopping: '待采购',
    cooking:  '进行中',
    done:     '已完成',
    skipped:  '没做成',
  };

  function newId(now) {
    // 不用随机数 —— 同一天多开一轮时加后缀,保证可复现、可排序
    return 'r' + now.slice(0, 10).replace(/-/g, '') + '-' + now.slice(11, 16).replace(':', '');
  }

  /** 从上一轮 + 长期配置推出这一轮的默认输入 */
  function defaultsFrom(lastRound, config, history) {
    var d = { days: 2, perDay: 2 };
    if (lastRound && lastRound.input) {
      d.days = lastRound.input.days;
      d.perDay = lastRound.input.perDay;
    }
    // 系统学到的:连续两轮没做满,默认值往下调(DESIGN 第六节 B 类自调)
    var recent = (history || []).filter(function (r) { return r.status === 'done'; }).slice(-2);
    if (recent.length === 2) {
      var rate = recent.reduce(function (s, r) {
        return s + (r.log && r.log.cookedCount != null
                    ? r.log.cookedCount / (r.input.days * r.input.perDay) : 1);
      }, 0) / 2;
      if (rate <= 0.6 && d.days > 1) {
        d.days -= 1;
        d.autoReduced = true;   // UI 要说明为什么默认值变了,不能默默改
      }
    }
    return d;
  }

  function create(input, config, now) {
    return {
      id: newId(now),
      createdAt: now,
      status: 'planning',
      input: {
        days: input.days,
        perDay: input.perDay,
        meals: input.days * input.perDay,
        overrides: input.overrides || {},   // 只存跟长期配置不同的项
      },
      configSnapshot: {                      // 生成当时的长期配置,便于事后解释结果
        equipment: (config.equipment || []).slice(),
        maxSpicy: config.maxSpicy,
        maxActiveMinutes: config.maxActiveMinutes,
        blacklist: (config.blacklist || []).slice(),
      },
      packages: [],      // 采购清单,勾「已买」后进库存
      meals: [],         // 排好的菜:{mealIndex, recipeId, prepLevel}
      log: {},           // 实际:{cookedCount, ratings:{}, actualMinutes:{}, leftovers:{}}
    };
  }

  /** 长期配置 + 这一轮的覆盖 = 求解器真正用的约束 */
  function effectiveConstraints(round, config) {
    var o = (round && round.input && round.input.overrides) || {};
    return {
      equipment: o.equipment || config.equipment,
      maxSpicy: o.maxSpicy != null ? o.maxSpicy : config.maxSpicy,
      maxActiveMinutes: o.maxActiveMinutes != null ? o.maxActiveMinutes : config.maxActiveMinutes,
      blacklist: (config.blacklist || []).concat(o.blacklistAdd || []),
      mustUse: o.mustUse || [],      // 临期库存,必须排掉
    };
  }

  /** 一句话摘要,列表里用 */
  function summarize(r) {
    var n = r.input.meals;
    var done = r.log && r.log.cookedCount != null ? r.log.cookedCount : null;
    if (r.status === 'done' && done != null) {
      return done + '/' + n + ' 顿做成' + (done < n ? '' : ' · 全做完了');
    }
    return n + ' 顿(' + r.input.days + ' 天 × ' + r.input.perDay + ')';
  }

  /** 这一轮跟长期配置有哪些不同 —— 列表里要能一眼看出「这次特殊在哪」 */
  function overrideLabels(r) {
    var o = (r.input && r.input.overrides) || {};
    var out = [];
    if (o.maxActiveMinutes != null) out.push('限 ' + o.maxActiveMinutes + ' 分钟');
    if (o.maxSpicy != null) out.push(['不吃辣', '微辣', '中辣', '重辣'][o.maxSpicy]);
    if (o.blacklistAdd && o.blacklistAdd.length) out.push('临时忌口 ' + o.blacklistAdd.length + ' 项');
    if (o.mustUse && o.mustUse.length) out.push('清 ' + o.mustUse.length + ' 样库存');
    return out;
  }

  return {
    STATUS: STATUS,
    defaultsFrom: defaultsFrom, create: create,
    effectiveConstraints: effectiveConstraints,
    summarize: summarize, overrideLabels: overrideLabels,
  };
})();

if (typeof module !== 'undefined') module.exports = Round;
