// 用你的真实配置跑 N 轮,输出人能读的计划文本
var path = require('path');
var APP = path.join(process.cwd(), 'app');
global.INGREDIENTS = require(path.join(APP, 'data/ingredients.js'));
global.RECIPES = require(path.join(APP, 'data/recipes.js'));
global.PACKAGES = require(path.join(APP, 'data/packages.js'));
var db = {};
global.Store = { get: function (k, f) { return db[k] !== undefined ? db[k] : (f === undefined ? null : f); },
                 set: function (k, v) { db[k] = v; } };
global.Equipment = require(path.join(APP, 'core/equipment.js'));
global.Timing = require(path.join(APP, 'core/timing.js'));
global.Catalog = require(path.join(APP, 'core/catalog.js'));
global.Packaging = require(path.join(APP, 'core/packaging.js'));
global.Pantry = require(path.join(APP, 'core/pantry.js'));
global.Nutrition = require(path.join(APP, 'core/nutrition.js'));
global.Meal = require(path.join(APP, 'core/meal.js'));
var Profile = require(path.join(APP, 'core/profile.js'));
var Solver = require(path.join(APP, 'core/solver.js'));

// —— 你的配置 ——
var CONS = {
  equipment: ['炒锅', '空气炸锅', '电饭煲'],
  maxSpicy: 1, maxActiveMinutes: 45, maxDifficulty: 3,
  maxIdleWait: 60, allowOvernight: false,
  blacklist: ['bitter_melon', 'okra', 'zucchini', 'canned_tuna'],
};
var daily = Profile.dailyTargets({ sex: 'male', age: 30, heightCm: 175, weightKg: 70,
                                   activity: 'light', goal: 'cut' });
var TARGET = Profile.perPlannedMeal(daily, 'light');

var N = parseInt(process.argv[2] || '100', 10);
var DUMP = process.argv[3] ? process.argv[3].split(',').map(Number) : [];
var rows = [], combos = {};
for (var seed = 0; seed < N; seed++) {
  // 用「最近做过」制造轮间差异,和真实使用一致
  var recent = {};
  var out = Solver.solve({ servings: 4, constraints: CONS, stock: {}, mustUse: [],
                           target: TARGET, recentRecipeIds: recent, seed: seed });
  if (!out.ok) { rows.push({ ok: false }); continue; }
  var meals = out.stage2.chosen.map(function (c) {
    var n = c.nutrition || {};
    // ⚠️ c.nutrition 是**已经把配菜/加量/补充项都叠进去的终值** ——
    //    solver 就地改的（solver.js:396 配菜 · :417 加量 · :446 补充项）。
    //    再加一遍是我上一版模拟脚本的错：热量凭空多算了一份，
    //    得出「超宽容带 48%」—— 不是求解器变差了，是标尺双了。
    var kcal = n.kcal || 0, pro = n.protein || 0, veg = n.veg || 0;
    var t = Timing.ofMeal(c.variant, c.side && c.side._cand && c.side._cand.variant);
    return { name: c.recipe.name, flavor: (c.recipe.flavor || [])[0] || '—',
             method: c.recipe.method,
             boost: c.boost, topUp: c.topUp, side: c.side,
             kcal: Math.round(kcal), pro: Math.round(pro), veg: Math.round(veg),
             active: t.active, eatIn: t.eatIn };
  });
  var key = meals.map(function (m) { return m.name; }).sort().join('|');
  combos[key] = 1;
  rows.push({ ok: true, meals: meals, waste: out.wasteRatio,
              buy: out.shopping.buy.length });
  if (DUMP.indexOf(seed) >= 0) {
    console.log('\n── 轮' + seed + ' ' + '─'.repeat(50));
    meals.forEach(function (m, i) {
      var s = '  ' + (i + 1) + '. ' + m.name + ' 〔' + m.flavor + '·' + m.method + '〕';
      if (m.boost) s += ' [' + m.boost.name + ' ' + m.boost.from + '→' + m.boost.to + 'g]';
      if (m.side) s += ' + ' + m.side.name;
      if (m.topUp) s += ' + 补' + m.topUp.name + m.topUp.grams + 'g';
      console.log(s);
      console.log('       ' + m.kcal + ' kcal · 蛋白 ' + m.pro + 'g · 菜 ' + m.veg
                  + 'g · 动手 ' + m.active + '分 · ' + m.eatIn + '分能吃上');
    });
    console.log('     浪费 ' + Math.round(rows[seed].waste * 100) + '% · 采购 ' + rows[seed].buy + ' 样');
    // ⚠️ 采购清单必须一起看。计划本身可能挺合理,清单却是「为了 8g 罗勒买一整盒」——
    //    而清单才是你真正带去超市的那张纸。
    console.log('     ── 采购清单 ──');
    var KIND = { protein: '荤', veg: '菜', staple: '主食/调料' };
    out.shopping.buy.forEach(function (b) {
      var p = b.plan;
      var line = '       [' + (KIND[b.kind] || '?') + '] ' + b.ing.name + '  要 ' + b.needGrams + 'g';
      if (p) {
        line += '  →  买 ' + (p.picks || []).map(function (x) {
          return x.count + ' × ' + x.spec.netWeight + (x.spec.unit || 'g')
                 + (x.spec.label ? '(' + x.spec.label + ')' : '');
        }).join(' + ') + ' = ' + p.total + 'g';
        var over = p.total - b.needGrams;
        // ⚠️ 只对**会烂的**标红。鸡蛋 80g 买 500g、挂面 110g 买 400g 剩得再多也不心疼,
        //    下周接着用;可西兰花 100g 买 300g 就是真要扔。
        //    一视同仁地标红会淹掉真问题 —— 我上一版就是这么读的,
        //    「一轮 5 样剩得比用的多」里有一半是鸡蛋挂面。
        if (over > 0) {
          line += '  剩 ' + over + 'g';
          if (over > b.needGrams) {
            line += (b.ing.tier === 'fresh') ? '  ← 会烂' : '(放得住)';
          }
        }
      } else line += '  ← 没有包装规格,不知道该买多少';
      console.log(line);
    });
  }
}

// ——— 统计 ———
var all = [];
rows.forEach(function (r) { if (r.ok) r.meals.forEach(function (m) { all.push(m); }); });
function med(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; }
function pct(f) { return Math.round(all.filter(f).length / all.length * 100) + '%'; }
console.log('\n' + '='.repeat(62));
console.log('失败 ' + rows.filter(function (r) { return !r.ok; }).length + '/' + N
          + ' · 不同组合 ' + Object.keys(combos).length + ' 种');
console.log('蛋白 中位 ' + med(all.map(function (m) { return m.pro; }))
          + 'g · 达标(≥85%目标 ' + Math.round(TARGET.protein * 0.85) + 'g) ' + pct(function (m) { return m.pro >= TARGET.protein * 0.85; }));
console.log('热量 中位 ' + med(all.map(function (m) { return m.kcal; }))
          + ' (目标 ' + TARGET.kcal + ') · 超 25% 宽容带 ' + pct(function (m) { return m.kcal > TARGET.kcal * 1.25; })
          + ' · 最高 ' + Math.max.apply(null, all.map(function (m) { return m.kcal; })));
console.log('动手 中位 ' + med(all.map(function (m) { return m.active; })) + '分 · 超 45 分 '
          + all.filter(function (m) { return m.active > 45; }).length + ' 顿');
console.log('浪费 中位 ' + Math.round(med(rows.filter(function(r){return r.ok;}).map(function (r) { return r.waste * 100; })) ) + '%'
          + ' · 采购 中位 ' + med(rows.filter(function(r){return r.ok;}).map(function (r) { return r.buy; })) + ' 样');
console.log('要额外补一样 ' + pct(function (m) { return !!m.topUp; })
          + ' · 主料加量 ' + pct(function (m) { return !!m.boost; })
          + ' · 配了青菜 ' + pct(function (m) { return !!m.side; }));

// 加量后单样克数分布
var big = all.filter(function (m) { return m.boost; })
             .map(function (m) { return m.boost.name + ' ' + m.boost.to + 'g'; });
var cnt = {}; big.forEach(function (x) { cnt[x] = (cnt[x] || 0) + 1; });
console.log('\n加量最多的:');
Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, 8)
  .forEach(function (k) { console.log('   ' + k + '  ×' + cnt[k]); });

// 一轮里味型重复
var dup = 0, dupEx = [];
rows.forEach(function (r, i) {
  if (!r.ok) return;
  var f = {}; r.meals.forEach(function (m) { f[m.flavor] = (f[m.flavor] || 0) + 1; });
  var max = Math.max.apply(null, Object.keys(f).map(function (k) { return f[k]; }));
  if (max >= 3) { dup++; if (dupEx.length < 3) dupEx.push('轮' + i + ' ' + r.meals.map(function(m){return m.flavor;}).join('/')); }
});
console.log('\n一轮四顿里有 ≥3 顿同味型的:' + dup + '/' + N);
dupEx.forEach(function (x) { console.log('   ' + x); });

// 补充项和主料撞车
var clash = 0;
all.forEach(function (m) {
  if (m.topUp && m.boost && m.topUp.ingredientId === m.boost.ingredientId) clash++;
});
console.log('补充项和加量的主料撞车:' + clash + ' 顿');
