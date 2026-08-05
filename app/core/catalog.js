// 从菜谱库/食材字典推导出来的候选池与过滤 —— 纯函数,不碰 DOM。
//
// 为什么不硬编码厨具/味型清单:数据层那条「能从字典推导的不重复存」原则同样适用于 UI。
// 库还在长,硬编码的勾选项迟早和数据对不上;推导出来的永远一致。

var Catalog = (function () {

  function tally(getter) {
    var m = {};
    RECIPES.forEach(function (r) {
      (getter(r) || []).forEach(function (k) {
        if (k && k !== '—') m[k] = (m[k] || 0) + 1;
      });
    });
    return Object.keys(m).map(function (k) { return { name: k, count: m[k] }; })
                         .sort(function (a, b) { return b.count - a.count; });
  }

  var _eq, _method, _flavor, _ingIndex;

  function equipment() {
    if (!_eq) _eq = tally(function (r) { return r.equipmentRequired; });
    return _eq;
  }
  function methods() {
    if (!_method) _method = tally(function (r) { return [r.method]; });
    return _method;
  }
  function flavors() {
    if (!_flavor) _flavor = tally(function (r) { return r.flavor; });
    return _flavor;
  }

  function ingredient(id) {
    if (!_ingIndex) {
      _ingIndex = {};
      INGREDIENTS.forEach(function (i) { _ingIndex[i.id] = i; });
    }
    return _ingIndex[id] || null;
  }

  /** 某道菜需要的厨具,在「拥有 + 菜谱级可替代 + 通用替代矩阵」下能不能满足。
   *  通用替代看 core/equipment.js —— 炒锅/汤锅/不粘锅在多数做法下能互顶,
   *  但爆炒必须有炒锅。这条规则是系统性的,不该逐道菜去标。 */
  function equipmentOK(recipe, owned, extraRequired) {
    return Equipment.check(recipe, owned, extraRequired).ok;
  }

  /** 这道菜的某个 variant 里有没有黑名单食材 */
  function variantHasBlacklisted(variant, blacklist) {
    if (!blacklist || !blacklist.length) return false;
    var bad = {};
    blacklist.forEach(function (b) { bad[b] = true; });
    return (variant.ingredients || []).concat(variant.seasonings || []).some(function (it) {
      // 「或」组:只有全部选项都被拉黑才算不能做
      return it.ids.length > 0 && it.ids.every(function (id) { return bad[id]; });
    });
  }

  /**
   * 在给定配置下,这道菜有哪些 variant 可做。
   * 返回可做的 variant 数组(空数组 = 这道菜做不了)。
   * ⚠️ 按 variant 判而不是按菜判 —— 这正是 prepLevel 存在的意义:
   *    手工水饺做不了(没时间),速冻水饺能做,不该把整道菜滤掉。
   */
  function availableVariants(recipe, cfg) {
    cfg = cfg || {};
    if (!equipmentOK(recipe, cfg.equipment)) return [];
    if (cfg.maxSpicy != null && recipe.spicy > cfg.maxSpicy) return [];

    return (recipe.variants || []).filter(function (v) {
      if (cfg.maxActiveMinutes != null && v.activeMinutes > cfg.maxActiveMinutes) return false;
      if (cfg.maxDifficulty != null && v.difficulty > cfg.maxDifficulty) return false;
      if (variantHasBlacklisted(v, cfg.blacklist)) return false;
      // variant 自己也可能要额外厨具(速冻版就不需要擀面杖)
      if (v.equipmentRequired && v.equipmentRequired.length) {
        if (!equipmentOK(recipe, cfg.equipment, v.equipmentRequired)) return false;
      }
      return true;
    });
  }

  /** 配置下可做的菜数。冷启动时实时显示,让取舍立刻看得见。 */
  function countAvailable(cfg) {
    var dishes = 0, variants = 0;
    RECIPES.forEach(function (r) {
      if (r.type === 'prep') return;         // prep 产出配料不是一顿饭,不计入
      var vs = availableVariants(r, cfg);
      if (vs.length) { dishes++; variants += vs.length; }
    });
    return { dishes: dishes, variants: variants,
             total: RECIPES.filter(function (r) { return r.type !== 'prep'; }).length };
  }

  /**
   * 每件厨具的**边际价值** —— 在你已有的基础上,加上/去掉它会差多少道菜。
   *
   * ⚠️ 这个数和「名义上挂着多少道」差很远,而且后者会误导采购决策:
   *    不粘锅名义挂 79 道,但炒锅几乎全能顶,实际只多解锁 3 道;
   *    烤箱名义只挂 18 道,却能顶掉空气炸锅那批,实际多 47 道。
   * 界面上要显示的是这个,不是名义数。
   */
  function equipmentMarginal(cfg) {
    var owned = (cfg.equipment || []).slice();
    var baseCfg = Object.assign({}, cfg);
    var base = countAvailable(baseCfg).dishes;

    return equipment().map(function (e) {
      var has = owned.indexOf(e.name) >= 0;
      var alt = has ? owned.filter(function (x) { return x !== e.name; })
                    : owned.concat([e.name]);
      var n = countAvailable(Object.assign({}, cfg, { equipment: alt })).dishes;
      return {
        name: e.name,
        owned: has,
        nominal: e.count,                 // 名义上有多少道菜点名要它
        delta: has ? base - n : n - base, // 有:去掉会损失多少;没有:加上会多多少
      };
    }).sort(function (a, b) { return b.delta - a.delta; });
  }

  /** 常见忌口的快选项。⚠️ 这是**配置层的快捷方式**,不是库的收录边界 ——
   *  库里内脏苦瓜折耳根一样不少,勾不勾由用户定。 */
  function commonDislikes() {
    var picks = ['cilantro', 'houttuynia', 'bitter_melon', 'okra', 'zucchini',
                 'lamb_leg', 'century_egg', 'durian', 'natto', 'blue_cheese'];
    var out = [];
    picks.forEach(function (id) {
      var ing = ingredient(id);
      if (ing) out.push({ id: id, name: ing.name });
    });
    // 内脏整类:从字典的类别推,不手写清单
    var organs = INGREDIENTS.filter(function (i) { return i.category === '内脏'; });
    if (organs.length) {
      out.push({ id: '@category:内脏', name: '内脏(' + organs.length + '种)',
                 expand: organs.map(function (i) { return i.id; }) });
    }
    return out;
  }

  /** 把 @category: / @allergen: 展开成真实 id 列表。
   *  过敏原尤其要整组展开 —— 「花生过敏」屏蔽的不是 `花生米` 一条,
   *  而是花生米 · 花生酱 · 花生油,漏一个就出事。 */
  function expandBlacklist(list) {
    var out = [];
    (list || []).forEach(function (b) {
      if (b.indexOf('@category:') === 0) {
        var c = b.slice(10);
        INGREDIENTS.forEach(function (i) { if (i.category === c) out.push(i.id); });
      } else if (b.indexOf('@allergen:') === 0) {
        var a = b.slice(10);
        INGREDIENTS.forEach(function (i) {
          if ((i.allergens || []).indexOf(a) >= 0) out.push(i.id);
        });
      } else out.push(b);
    });
    return out;
  }

  return {
    equipment: equipment, methods: methods, flavors: flavors,
    ingredient: ingredient,
    equipmentOK: equipmentOK, availableVariants: availableVariants,
    countAvailable: countAvailable, equipmentMarginal: equipmentMarginal,
    commonDislikes: commonDislikes, expandBlacklist: expandBlacklist,
  };
})();

if (typeof module !== 'undefined') module.exports = Catalog;
