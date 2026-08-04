// 库存 —— 纯函数,不碰 DOM。
//
// ⚠️ 两种库存,策略完全不同,不能一套走到底:
//
//   staple(调料 · 米面油)      **二元**:有 / 没有。你不会去称家里还剩多少盐。
//                              不进每周采购清单,只在没有或临期时提醒。
//   fresh / buffer(生鲜 · 冷冻) **定量**:还剩多少克、什么时候过期。
//                              这才是这个项目真正的护城河 —— 别人抄不走的状态。
//
// 另一条(给求解器的):**缺调料不是过滤器,是扣分项。**
//   没有郫县豆瓣不代表做不了麻婆豆腐,代表要多买一瓶。
//   但一道菜缺 5 样调料就是个坏选择 —— 为一顿饭买五瓶,那才是把浪费从冰箱搬到柜子里。

var Pantry = (function () {

  // ---- 调料储物柜 ----
  //
  // ⚠️ 不能只记「有 / 没有」—— 调料的浪费主要发生在**开封之后**,而且比生鲜浪费更隐蔽:
  //    椰浆 400ml/罐开封后只能放 2 天、番茄罐头 3 天、做菜用的红酒 3 天。
  //    做个咖喱用 100ml,剩下 300ml 两天后就废了,而半罐椰浆不像烂菠菜那样刺眼。
  //    382 种调料里 266 种有「开封后有效期」,165 种标了「必然过量」。
  //
  // 存成 [{id, openedAt}],openedAt 为 null 表示「有,但没记开封时间」。
  // **不强求填** —— 只对开封后短保的品类才值得问,盐和糖问了也没意义。

  function staples() {
    var raw = Store.get('staples', null);
    if (raw === null) return null;
    // 兼容早期版本的纯字符串数组
    return raw.map(function (x) {
      return typeof x === 'string' ? { id: x, openedAt: null } : x;
    });
  }

  /** 第一次用:DESIGN 里的「启动包 11 样」预勾上,其余按需解锁 */
  var STARTER = ['salt', 'cooking_oil', 'light_soy_sauce', 'oyster_sauce', 'white_sugar',
                 'white_pepper', 'corn_starch', 'cooking_wine', 'cumin', 'black_pepper',
                 'sesame_oil'];

  /** 开封后有效期短于这个天数才值得记开封时间 —— 盐糖问了没意义 */
  var ASK_OPENED_UNDER_DAYS = 200;

  function worthTrackingOpened(ing) {
    return !!(ing && ing.openedShelfLifeDays && ing.openedShelfLifeDays <= ASK_OPENED_UNDER_DAYS);
  }

  function ensureInit() {
    if (staples() === null) {
      Store.set('staples', STARTER.map(function (id) { return { id: id, openedAt: null }; }));
    }
    return staples();
  }

  function stapleEntry(id) {
    return (staples() || []).filter(function (x) { return x.id === id; })[0] || null;
  }

  function hasStaple(id) { return !!stapleEntry(id); }

  function toggleStaple(id) {
    var list = (staples() || []).slice();
    var i = list.findIndex(function (x) { return x.id === id; });
    if (i >= 0) list.splice(i, 1);
    else list.push({ id: id, openedAt: null });
    Store.set('staples', list);
    return list;
  }

  function setOpened(id, iso) {
    var list = (staples() || []).slice();
    var e = list.filter(function (x) { return x.id === id; })[0];
    if (!e) return null;
    e.openedAt = iso;
    Store.set('staples', list);
    return e;
  }

  /** 开封后已经过期 / 快过期的调料。
   *  这一条直接对着 DESIGN 第四节:staple 不进每周采购清单,**只在快没了/临期时提醒**。 */
  function stapleAlerts(now, warnDays) {
    var t = Date.parse(now);
    var warn = (warnDays || 14) * 864e5;
    var out = [];
    (staples() || []).forEach(function (e) {
      if (!e.openedAt) return;
      var ing = INGREDIENTS.filter(function (i) { return i.id === e.id; })[0];
      if (!ing || !ing.openedShelfLifeDays) return;
      var dead = Date.parse(e.openedAt) + ing.openedShelfLifeDays * 864e5;
      var left = Math.round((dead - t) / 864e5);
      if (dead - t > warn) return;
      out.push({
        id: e.id, name: ing.name, daysLeft: left,
        expired: left < 0,
        openedShelfLifeDays: ing.openedShelfLifeDays,
        packaging: ing.packaging,
        // 能救的话给动作:多排用它的菜。接不上动作的提醒就是噪音。
        usedInDishes: unlockValue(e.id),
      });
    });
    return out.sort(function (a, b) { return a.daysLeft - b.daysLeft; });
  }

  /** 买之前就该知道:这个规格你多半吃不完。
   *  盒马调研已经产出一批名单(白胡椒粉 220g、椒盐 300g 这类单人年消耗都吃不完)。 */
  function surplusWarning(ingredientId) {
    var ing = INGREDIENTS.filter(function (i) { return i.id === ingredientId; })[0];
    if (!ing || !ing.inevitableSurplus) return null;
    return {
      name: ing.name,
      packaging: ing.packaging,
      openedShelfLifeDays: ing.openedShelfLifeDays,
      text: '最小规格(' + (ing.packaging || '?') + ')一个人多半吃不完' +
            (ing.openedShelfLifeDays ? ',开封后只能放 ' + ing.openedShelfLifeDays + ' 天' : '') +
            ' —— 买之前想一下值不值。',
    };
  }

  // ---- 生鲜库存(定量)----

  function items() { return Store.get('pantryItems', []) || []; }
  function saveItems(v) { Store.set('pantryItems', v); }

  /** 采购清单勾「已买」→ 按包装规格自动建条目。零额外录入是硬要求:
   *  要手动管库存的话,三周就没人用了。 */
  function addFromPackage(pkg, now, location) {
    var ing = INGREDIENTS.filter(function (i) { return i.id === pkg.ingredientId; })[0];
    var shelf = ing && ing.shelfLifeDays ? ing.shelfLifeDays : null;
    var list = items();
    list.push({
      id: 'pi-' + now.replace(/[^0-9]/g, '').slice(0, 14) + '-' + list.length,
      ingredientId: pkg.ingredientId,
      packageId: pkg.id,
      amount: pkg.netWeight,
      unit: pkg.unit || 'g',
      addedAt: now,
      openedAt: null,
      expiresAt: shelf ? new Date(Date.parse(now) + shelf * 864e5).toISOString() : null,
      location: location || (ing && ing.tier === 'buffer' ? 'freezer' : 'fridge'),
      source: 'purchase',
    });
    saveItems(list);
    return list[list.length - 1];
  }

  /** 某顿点「完成」→ 按用量自动扣减。可以传实际称重值覆盖菜谱标的量。 */
  function consume(ingredientId, grams, now) {
    var list = items();
    var left = grams;
    // 先扣快过期的 —— 临期的必须先用掉,这是三级策略里 fresh 的硬约束
    list.filter(function (it) { return it.ingredientId === ingredientId && it.amount > 0; })
        .sort(function (a, b) {
          return (Date.parse(a.expiresAt || '9999') - Date.parse(b.expiresAt || '9999'));
        })
        .forEach(function (it) {
          if (left <= 0) return;
          var take = Math.min(it.amount, left);
          it.amount -= take;
          left -= take;
          if (!it.openedAt) it.openedAt = now;
        });
    saveItems(list.filter(function (it) { return it.amount > 0.01; }));
    return { shortfall: left > 0.01 ? left : 0 };   // 不够就如实返回,不静默补零
  }

  function totalOf(ingredientId) {
    return items().filter(function (it) { return it.ingredientId === ingredientId; })
                  .reduce(function (s, it) { return s + it.amount; }, 0);
  }

  /** 临期的:求解器要优先把它们排掉 */
  function expiringSoon(days, now) {
    var cut = Date.parse(now) + (days || 3) * 864e5;
    return items().filter(function (it) {
      return it.expiresAt && Date.parse(it.expiresAt) <= cut;
    }).sort(function (a, b) { return Date.parse(a.expiresAt) - Date.parse(b.expiresAt); });
  }

  // ---- 给求解器用 ----

  /** 这个 variant 要用到、而储物柜里没有的调料。**不是过滤条件,是扣分项。** */
  function missingSeasonings(variant) {
    var out = [];
    (variant.seasonings || []).forEach(function (s) {
      // 「或」组只要有一样就算有
      if (s.ids.some(function (id) { return hasStaple(id); })) return;
      out.push(s.ids[0]);
    });
    return out;
  }

  /** 某样调料还能解锁多少道菜 —— 和厨具的边际价值同一个思路:
   *  回答的是「值不值得买这瓶」,不是「我有什么」。 */
  function unlockValue(ingredientId) {
    var n = 0;
    RECIPES.forEach(function (r) {
      if (r.type === 'prep') return;
      var hit = (r.variants || []).some(function (v) {
        return (v.seasonings || []).some(function (s) {
          return s.ids.indexOf(ingredientId) >= 0;
        });
      });
      if (hit) n++;
    });
    return n;
  }

  /** 现在缺的调料里,哪几样最值得补 */
  function suggestUnlocks(limit) {
    var owned = (staples() || []).map(function (x) { return x.id; });
    var counts = {};
    RECIPES.forEach(function (r) {
      if (r.type === 'prep') return;
      (r.variants || []).forEach(function (v) {
        (v.seasonings || []).forEach(function (s) {
          if (s.ids.some(function (id) { return owned.indexOf(id) >= 0; })) return;
          var id = s.ids[0];
          (counts[id] = counts[id] || { id: id, dishes: {} }).dishes[r.id] = 1;
        });
      });
    });
    return Object.keys(counts).map(function (id) {
      var ing = INGREDIENTS.filter(function (i) { return i.id === id; })[0];
      return {
        id: id,
        name: ing ? ing.name : id,
        dishes: Object.keys(counts[id].dishes).length,
        inevitableSurplus: ing ? !!ing.inevitableSurplus : false,
        packaging: ing ? ing.packaging : null,
      };
    }).sort(function (a, b) { return b.dishes - a.dishes; }).slice(0, limit || 20);
  }

  return {
    STARTER: STARTER, staples: staples, stapleEntry: stapleEntry,
    worthTrackingOpened: worthTrackingOpened, setOpened: setOpened,
    stapleAlerts: stapleAlerts, surplusWarning: surplusWarning,
    ensureInit: ensureInit, hasStaple: hasStaple, toggleStaple: toggleStaple,
    items: items, addFromPackage: addFromPackage, consume: consume,
    totalOf: totalOf, expiringSoon: expiringSoon,
    missingSeasonings: missingSeasonings, unlockValue: unlockValue,
    suggestUnlocks: suggestUnlocks,
  };
})();

if (typeof module !== 'undefined') module.exports = Pantry;
