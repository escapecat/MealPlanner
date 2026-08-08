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

  /** 一次采购能撑几天,受 fresh 食材保鲜期限制。
   *  这不是「不许超过 N 天」,是「超过之后后面几顿得换食材类型」—— 说明取舍,不拦人。
   *  数据依据:140 种 fresh 食材里只有 27 种能撑过 5 天;水产/畜肉/内脏只有 1-3 天;
   *  但有 148 种可冷冻。 */
  function freshnessNote(days) {
    if (days <= 2) return null;
    if (days === 3) {
      return { level: 'ok', text: '第 3 天的鲜肉和叶菜要排在前面吃 —— 冷藏也就撑这么久。' };
    }
    if (days <= 5) {
      return { level: 'warn', text:
        '超过 3 天,后面几顿基本得靠**冷冻肉 + 根茎菜**(土豆胡萝卜白菜这类)。' +
        '鲜鱼鲜虾只能排头两天。' };
    }
    return { level: 'warn', text:
      '一次买 ' + days + ' 天的量,最后两三顿会全是冷冻和干货 —— ' +
      '要么中间补一次货,要么接受后半程没有鲜菜。' };
  }

  /** 人数对采购的影响。这是这个应用的核心洞察反过来用:
   *  包装规格对一个人来说是「2 顿的量」,人越多越接近「1 顿正好」,剩余问题反而变简单。 */
  function dinersNote(diners, meals) {
    if (diners <= 1) return null;
    if (diners === 2) {
      return '两个人吃,一包 300g 的肉正好一顿 —— 剩余问题基本消失,' +
             '「主料复用、做法不重复」这条约束也松了。';
    }
    return diners + ' 个人吃,一包不够一顿,得按整包的倍数买 —— ' +
           '这时候该担心的不是剩,是买少了。';
  }

  function newId(now) {
    // 不用随机数 —— 同一天多开一轮时加后缀,保证可复现、可排序
    return 'r' + now.slice(0, 10).replace(/-/g, '') + '-' + now.slice(11, 16).replace(':', '');
  }

  /** 从上一轮 + 长期配置推出这一轮的默认输入 */
  function defaultsFrom(lastRound, config, history) {
    var d = { days: 2, perDay: 2, diners: 1 };
    if (lastRound && lastRound.input) {
      d.days = lastRound.input.days;
      d.perDay = lastRound.input.perDay;
      d.diners = lastRound.input.diners || 1;
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
        diners: input.diners || 1,
        meals: input.days * input.perDay,
        // 要做的「份数」= 顿数 x 人数。营养目标仍是**你一个人的**,
        // 别人饭量不同,这里只是按你的量粗略放大 —— UI 里说清楚了。
        servings: input.days * input.perDay * (input.diners || 1),
        overrides: input.overrides || {},   // 只存跟长期配置不同的项
      },
      configSnapshot: {                      // 生成当时的长期配置,便于事后解释结果
        equipment: (config.equipment || []).slice(),
        maxSpicy: config.maxSpicy,
        maxActiveMinutes: config.maxActiveMinutes,
        maxIdleWait: config.maxIdleWait,
        allowOvernight: config.allowOvernight,
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
      // 「多久能吃上」是另一条约束:动手 20 分但锅里焖 90 分钟的菜,
      // 动手上限拦不住它,可你饿着等的就是那 90 分钟。
      maxIdleWait: o.maxIdleWait != null ? o.maxIdleWait : config.maxIdleWait,
      allowOvernight: o.allowOvernight != null ? o.allowOvernight : config.allowOvernight,
      blacklist: (config.blacklist || []).concat(o.blacklistAdd || []),
      mustUse: o.mustUse || [],      // 临期库存,必须排掉
    };
  }

  /** 一句话摘要,列表里用 */
  function summarize(r) {
    var n = r.input.meals;
    var d = r.input.diners || 1;
    var who = d > 1 ? ' · ' + d + ' 个人' : '';
    var done = r.log && r.log.cookedCount != null ? r.log.cookedCount : null;
    if (r.status === 'done' && done != null) {
      return done + '/' + n + ' 顿做成' + who + (done < n ? '' : ' · 全做完了');
    }
    return n + ' 顿(' + r.input.days + ' 天 × ' + r.input.perDay + ')' + who;
  }

  /** 这一轮跟长期配置有哪些不同 —— 列表里要能一眼看出「这次特殊在哪」 */
  function overrideLabels(r) {
    var o = (r.input && r.input.overrides) || {};
    var out = [];
    if (o.maxActiveMinutes != null) out.push('限动手 ' + o.maxActiveMinutes + ' 分钟');
    if (o.maxIdleWait != null) {
      out.push(o.maxIdleWait >= 9999 ? '不限等待'
               : '最多等 ' + (o.maxIdleWait >= 60 ? (o.maxIdleWait / 60) + ' 小时'
                                                  : o.maxIdleWait + ' 分钟'));
    }
    if (o.allowOvernight != null) out.push(o.allowOvernight ? '这次可以隔夜' : '这次不要隔夜');
    if (o.maxSpicy != null) out.push(['不吃辣', '微辣', '中辣', '重辣'][o.maxSpicy]);
    if (o.blacklistAdd && o.blacklistAdd.length) out.push('临时忌口 ' + o.blacklistAdd.length + ' 项');
    if (o.mustUse && o.mustUse.length) out.push('清 ' + o.mustUse.length + ' 样库存');
    return out;
  }

  return {
    STATUS: STATUS,
    freshnessNote: freshnessNote, dinersNote: dinersNote,
    defaultsFrom: defaultsFrom, create: create,
    effectiveConstraints: effectiveConstraints,
    summarize: summarize, overrideLabels: overrideLabels,
  };
})();

if (typeof module !== 'undefined') module.exports = Round;
