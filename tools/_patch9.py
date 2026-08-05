# -*- coding: utf-8 -*-
# 调料柜默认不再预勾 11 样 —— 那是采购建议,不是「你已经有」
import io, os
os.chdir(r"C:\Users\weideng\MealPlanner\app")

# ---- core/pantry.js ----
p = 'core/pantry.js'
s = io.open(p, encoding='utf-8').read()

old = """  /** 第一次用:DESIGN 里的「启动包 11 样」预勾上,其余按需解锁 */
  var STARTER = ['salt', 'cooking_oil', 'light_soy_sauce', 'oyster_sauce', 'white_sugar',
                 'white_pepper', 'corn_starch', 'cooking_wine', 'cumin', 'black_pepper',
                 'sesame_oil'];"""
assert s.count(old) == 1, 'STARTER doc not found'
new = """  /** 最常用的 11 样。
   *
   * ⚠️ 这是**建议清单,不是默认已有**。
   *    DESIGN 里写的是「调料按需解锁,建议先买 11 样」—— 那是一条采购建议。
   *    早先我把它实现成了「用户已经有这 11 样」,后果不只是列表难看:
   *    **采购清单永远不会提醒你买盐、油、生抽**,因为系统以为你有;
   *    生成计划时算「缺几样调料」也全是错的。
   *    替用户假设他有什么,和替他假设他不吃什么一样,都不该做。 */
  var STARTER = ['salt', 'cooking_oil', 'light_soy_sauce', 'oyster_sauce', 'white_sugar',
                 'white_pepper', 'corn_starch', 'cooking_wine', 'cumin', 'black_pepper',
                 'sesame_oil'];"""
s = s.replace(old, new)

old2 = """  function ensureInit() {
    if (staples() === null) {
      Store.set('staples', STARTER.map(function (id) { return { id: id, addedAt: null, openedAt: null }; }));
    }
    return staples();
  }"""
assert s.count(old2) == 1, 'ensureInit not found'
new2 = """  function ensureInit() {
    if (staples() === null) Store.set('staples', []);   // 默认空 —— 不替用户假设他有什么
    return staples();
  }

  /** 用户确认过一次「我有哪些」了吗 —— 没确认过就该问,而不是猜 */
  function confirmed() { return !!Store.get('staplesConfirmed', false); }
  function setConfirmed() { Store.set('staplesConfirmed', true); }"""
s = s.replace(old2, new2)

s = s.replace("    STARTER: STARTER, staples: staples, stapleEntry: stapleEntry,",
              "    STARTER: STARTER, staples: staples, stapleEntry: stapleEntry,\n    confirmed: confirmed, setConfirmed: setConfirmed,")
io.open(p, 'w', encoding='utf-8', newline='').write(s)

# ---- ui/pantry.js:没确认过就先问 ----
p = 'ui/pantry.js'
s = io.open(p, encoding='utf-8').read()
old3 = """  function renderStaples(w) {
    Pantry.ensureInit();
    var mine = Pantry.staples() || [];"""
assert s.count(old3) == 1
new3 = """  function renderStaples(w) {
    Pantry.ensureInit();
    var mine = Pantry.staples() || [];

    // 第一次进来:问一遍常用的这几样有没有。**问,不是猜。**
    if (!Pantry.confirmed()) {
      w.appendChild(h('div', { class: 'note' }, [
        '先花十秒勾一下 —— 这几样最常用。**没勾的会出现在采购清单上**,' +
        '所以别勾你其实没有的。',
      ]));
      var c0 = h('div', { class: 'card', style: 'padding:2px 14px' });
      Pantry.STARTER.forEach(function (id) {
        var ing = INGREDIENTS.filter(function (x) { return x.id === id; })[0];
        if (ing) c0.appendChild(pickRow(ing));
      });
      w.appendChild(c0);
      w.appendChild(h('button', {
        class: 'btn', style: 'margin-top:12px',
        onclick: function () { Pantry.setConfirmed(); render(); },
      }, ['勾好了(' + mine.length + ' 样)']));
      w.appendChild(h('button', {
        class: 'btn ghost', style: 'margin-top:8px',
        onclick: function () { Pantry.setConfirmed(); render(); },
      }, ['一样都没有,跳过']));
      w.appendChild(h('div', { class: 'hint', style: 'text-align:center;margin-top:8px' }, [
        '之后随时能改。别的调料不用在这儿备齐 —— 生成计划时缺哪样会直接问你。',
      ]));
      return;
    }"""
s = s.replace(old3, new3)
io.open(p, 'w', encoding='utf-8', newline='').write(s)
print('written')
