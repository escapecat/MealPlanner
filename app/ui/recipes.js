// 「菜谱」页 —— 库里到底有什么。
//
// 这一页和别的页不同:它**不推动流程**,只回答查询。三个问题:
//   1. 库里有哪些菜、分几类(像番种表那样能一档一档翻)
//   2. 某道菜要什么材料、什么属性
//   3. **这道菜收录了没有** —— 这个问题只有搜索能回答,而且答案必须明确说「没有」
//
// ⚠️ 512 道菜平铺出来就是第二堵墙(包装规格页和 370 条调料墙都是这么死的)。
//    所以:搜索框置顶、分组默认折叠、点开才展开细节。
//    默认看到的是「六个类别 + 各多少道」,不是 512 行。

var RecipesUI = (function () {

  var el, q = '', groupBy = 'file', openG = {}, openD = {}, view = 'all',
      composing = false;      // 中文输入法正在组字 —— 这期间不能重渲染

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === 'string' ? Dom.text(c) : c);
    });
    return n;
  }

  var CUISINE = {
    '01': '家常基础', '02': '川湘云贵', '03': '粤浙闽',
    '04': '北方家常', '05': '西式', '06': '日韩东南亚',
  };

  function config() { return Store.get('config', {}) || {}; }
  function dishes() { return RECIPES.filter(function (r) { return r.type !== 'prep'; }); }
  function preps() { return RECIPES.filter(function (r) { return r.type === 'prep'; }); }

  /** 在当前设置下这道菜做不做得了 —— 这是静态菜谱书给不了的东西 */
  function doable(r) {
    return Catalog.availableVariants(r, config()).length > 0;
  }

  function keyOf(r) {
    if (groupBy === 'file') return CUISINE[r.file] || r.file;
    if (groupBy === 'method') return r.method || '其他';
    return (r.flavor && r.flavor[0]) || '其他';
  }

  // ---------------- 单道菜 ----------------

  function attrLine(r, v) {
    var bits = [r.method];
    if (v) {
      // 先说能吃上,再拆成「动手 + 等」—— 这两个数对你的要求完全不同
      var t = Timing.ofMeal(v, null);
      bits.push(Timing.fmt(t.eatIn) + '能吃上' + (t.overnight ? '(要隔夜)' : ''));
      bits.push('动手 ' + v.activeMinutes + ' 分' +
                (t.idle ? ' + 等 ' + Timing.fmt(t.idle) : '') + ' 估');
      bits.push('难度 ' + v.difficulty);
    }
    if (r.spicy) bits.push(['', '微辣', '中辣', '重辣'][r.spicy] || ('辣度 ' + r.spicy));
    if (r.keepsOvernight) bits.push('能隔顿');
    if (r.raw) bits.push('生食');
    return bits.join(' · ');
  }

  /** 展示用的小标签。
   *  ⚠️ 用 .tag,**不是 .chips button** —— 那个是可点的,有 44px 触摸下限,
   *     拿来标食材会让一行食材撑成两行按钮。可点的和不可点的必须分开。 */
  function chip(text, kind) {
    var cls = 'tag' + (kind === 'main' ? ' strong' : '');
    return h('span', { class: cls,
                       style: kind === 'dashed' ? 'border:1px dashed var(--border-2)' : null },
             [text]);
  }

  function detail(r) {
    var box = h('div', { style: 'margin-top:8px' });
    var cfg = config();
    var avail = Catalog.availableVariants(r, cfg);

    (r.variants || []).forEach(function (v, i) {
      var ok = avail.indexOf(v) >= 0;
      if (r.variants.length > 1) {
        box.appendChild(h('div', { class: 'hint', style: 'margin-top:8px;font-weight:600' }, [
          ({ scratch: '从头做', assembled: '半成品', readymade: '买现成的' }[v.prepLevel]
            || v.prepLevel) + (ok ? '' : ' · 当前设置下做不了'),
        ]));
      }
      box.appendChild(h('div', { class: 'hint' }, [attrLine(r, v)]));

      if (v.aheadOfTime && v.aheadOfTime !== '—') {
        box.appendChild(h('div', { class: 'hint', style: 'color:var(--warn)' },
          ['提前:' + v.aheadOfTime]));
      }

      var line = h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap;margin-top:8px' });
      (v.ingredients || []).forEach(function (it) {
        line.appendChild(chip(
          it.names.join('/') + (it.qty ? ' ' + it.qty + (it.unit || 'g') : (it.toTaste ? ' 适量' : '')),
          it.role === 'main' ? 'main' : null));
      });
      var nu = Nutrition.ofMeal(v);
      if (nu && nu.staple) {
        line.appendChild(chip('配 ' + nu.staple.name + ' ' + nu.staple.grams + 'g', 'dashed'));
      }
      box.appendChild(line);

      if ((v.seasonings || []).length) {
        box.appendChild(h('div', { style: 'display:flex;gap:4px;flex-wrap:wrap;margin-top:8px' },
          v.seasonings.map(function (it) {
            var have = it.ids.some(function (id) { return Pantry.hasStaple(id); });
            return h('span', { class: 'tag' + (have ? '' : ' warn') },
                     [it.names.join('/') + (have ? '' : ' 没有')]);
          })));
      }

      if (nu) {
        box.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' }, [
          '约 ' + nu.kcal + ' kcal · 蛋白 ' + nu.protein + 'g · 蔬菜 ' + nu.veg + 'g' +
          (nu.selfContained ? ' · 自带主食' : ' · 已含那碗饭'),
        ]));
      }
      if (v.note && v.note !== '—') {
        box.appendChild(h('div', { class: 'hint' }, ['· ' + v.note]));
      }
      if (v.equipmentRequired && v.equipmentRequired.length) {
        box.appendChild(h('div', { class: 'hint' }, ['要 ' + v.equipmentRequired.join(' · ')]));
      }

      // ⚠️ 「你是拿什么顶的、要注意什么」以前**一处都没显示**。
      //    替代矩阵里每条都写了限制条件(「锅底放水架个碗」「不粘锅火别开太大」),
      //    写了不给人看等于白写 —— 而这正是「我没有蒸架但还是能做」的关键信息。
      var chk = Equipment.check(r, cfg.equipment,
                                (v.equipmentRequired && v.equipmentRequired.length)
                                  ? v.equipmentRequired : null);
      (chk.subs || []).forEach(function (sub) {
        if (!sub.note) return;
        box.appendChild(h('div', { class: 'note', style: 'margin-top:8px' }, [
          '你没有这个,用 **' + sub.via + '** 顶:' + sub.note,
        ]));
      });
    });

    box.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' }, [
      r.id + ' · ' + (CUISINE[r.file] || r.file) + ' · ' + (r.flavor || []).join('/') +
      ' · 厨具 ' + ((r.equipmentRequired || []).join('/') || '无要求') +
      // 全库 verified 都是 false,不标出来就等于默认它是核实过的
      ' · 数据未核实',
    ]));

    box.appendChild(h('a', {
      class: 'btn ghost',
      style: 'width:auto;padding:4px 12px;font-size:13px;text-decoration:none;' +
             'display:inline-block;margin-top:8px',
      href: 'https://www.xiachufang.com/search/?keyword=' + encodeURIComponent(r.name),
      target: '_blank', rel: 'noopener',
    }, ['搜做法 ↗']));

    box.appendChild(h('button', {
      class: 'btn ghost',
      style: 'width:auto;padding:4px 12px;font-size:13px;margin-top:8px;margin-left:8px',
      onclick: function () { editRecipe(r); },
    }, [RecipeBook.hasOverride(r.id) ? '改过了 · 再改' : '按我的情况改']));

    if (RecipeBook.hasOverride(r.id)) {
      var orig = RecipeBook.original(r.id);
      var ov = (RecipeBook.overrides()[r.id] || {});
      var diffs = [];
      var ta = (ov.all || {});
      Object.keys(ov.byLevel || {}).forEach(function (k) {
        Object.assign(ta, ov.byLevel[k]);
      });
      var ov0 = orig && orig.variants[0];
      if (ta.activeMinutes != null && ov0) diffs.push('动手 ' + ov0.activeMinutes + ' → ' + ta.activeMinutes + ' 分');
      if (ta.totalMinutes != null && ov0) diffs.push('总时长 ' + ov0.totalMinutes + ' → ' + ta.totalMinutes + ' 分');
      if (ta.difficulty != null && ov0) diffs.push('难度 ' + ov0.difficulty + ' → ' + ta.difficulty);
      if (ta.spicy != null && orig) diffs.push('辣度 ' + orig.spicy + ' → ' + ta.spicy);
      if (ta.equipmentRequired) diffs.push('厨具改成 ' + (ta.equipmentRequired.join('/') || '无要求'));
      if (ta.aheadOfTime !== undefined) {
        diffs.push('提前准备改成「' + (ta.aheadOfTime || '不用提前') + '」');
      }
      if (ta.grams) diffs.push(Object.keys(ta.grams).length + ' 样改了用量');
      if (ta.remove && ta.remove.length) diffs.push('去掉 ' + ta.remove.length + ' 样');
      if (ta.add && ta.add.length) diffs.push('加了 ' + ta.add.length + ' 样');
      box.appendChild(h('div', { class: 'note', style: 'margin-top:8px' }, [
        '**你改过这道**:' + (diffs.join(' · ') || '有改动') +
        '。库里的原值没动,改的只是你这边的一层。',
      ]));
    }
    return box;
  }

  /**
   * 按自己的情况校准。
   *
   * ⚠️ 这不是「编辑菜谱」—— 库里的事实一个字不动,只记**你和默认值的差**。
   *    所以以后菜谱库更新了(补了道菜、修了个克数),你的校准仍然贴在新数据上,
   *    不会把你锁死在一份过期快照里。和包装规格校准是同一个模式。
   *
   * ⚠️ 每一层都能**返回上一层**,不是只能取消。
   *    第一版是「选完就走」的一条道:菜名 → 食材 → 某一样 → 改用量 四层,
   *    中途想退一步只能点「取消」,而取消是把整串关掉回到页面 ——
   *    点错一个选项就得从头再点四次。
   *    写法上就是每层用 while(true) 循环,拿到 Modal.BACK 就 continue 回上一层。
   */
  function editRecipe(r) {
    var v = r.variants[0];

    function menu() {
      var opts = [
        { key: 'active', label: '动手时间', hint: '现在记 ' + v.activeMinutes + ' 分 —— 你做实际要多久?' },
        { key: 'total', label: '多久能吃上', hint: '现在记 ' + v.totalMinutes + ' 分(不含提前准备)' },
        { key: 'difficulty', label: '难度', hint: '现在记 ' + v.difficulty + ' —— 对你来说呢?' },
        { key: 'spicy', label: '辣度', hint: '现在记 ' + (['不辣', '微辣', '中辣', '重辣'][r.spicy] || r.spicy) },
        { key: 'ahead', label: '提前准备',
          hint: v.aheadOfTime ? '现在记「' + v.aheadOfTime + '」' : '现在记「不用提前」' },
        { key: 'equip', label: '要用的厨具',
          hint: (r.equipmentRequired || []).join(' + ') || '现在记「无要求」' },
      ];
      if ((v.ingredients || []).length) {
        opts.push({ key: 'ing', label: '食材', hint: '改用量 / 去掉 / 加一样' });
      }
      if (RecipeBook.hasOverride(r.id)) {
        opts.push({ key: 'reset', label: '还原成库里的原值',
                    hint: '丢掉你对这道菜的全部改动', danger: true });
      }
      return Modal.pick({
        title: r.name,
        hint: '改的只是你这边的一层,库里的原值不动,随时能还原。',
        options: opts,
      });
    }

    function loop() {
      return menu().then(function (k) {
        if (!k || k === Modal.BACK) return;
        return step(k).then(function (res) {
          // 子步骤点了「返回」→ 回到这一层的菜单;做完了或取消了 → 结束
          if (res === Modal.BACK) return loop();
          if (res === 'done') { render(); return; }
        });
      });
    }

    function step(k) {
      if (k === 'reset') {
        return Modal.confirm({
          title: '还原「' + r.name + '」?',
          body: '你对这道菜改过的时间/难度/辣度/厨具/食材全部丢掉,回到库里的原值。',
          ok: '还原', danger: true,
        }).then(function (yes) {
          if (!yes) return Modal.BACK;
          RecipeBook.reset(r.id);
          return 'done';
        });
      }

      if (k === 'spicy') {
        return Modal.pick({
          title: '你吃着有多辣?',
          hint: '改了之后「能吃多辣」那条设置会按你的判断筛,不是按库里的。',
          back: true,
          options: [0, 1, 2, 3].map(function (n) {
            return { key: String(n), label: ['不辣', '微辣', '中辣', '重辣'][n],
                     hint: n === r.spicy ? '现在记的就是这个' : null };
          }),
        }).then(function (sp) {
          if (sp === Modal.BACK) return Modal.BACK;
          if (sp == null) return null;
          RecipeBook.save(r.id, { spicy: parseInt(sp, 10) });
          return 'done';
        });
      }

      if (k === 'difficulty') {
        return Modal.pick({
          title: '对你来说多难?', back: true,
          options: [1, 2, 3, 4, 5].map(function (n) {
            return { key: String(n), label: n + ' 级',
                     hint: n === v.difficulty ? '现在记的就是这个' : null };
          }),
        }).then(function (d) {
          if (d === Modal.BACK) return Modal.BACK;
          if (d == null) return null;
          RecipeBook.save(r.id, { difficulty: parseInt(d, 10) });
          return 'done';
        });
      }

      if (k === 'ahead') {
        return Modal.ask({
          title: '这道要提前准备什么?',
          hint: '库里记的是「' + (v.aheadOfTime || '不用提前') + '」。留空 = 不用提前。' +
                '**改了之后「最多能等多久」那条筛选会跟着变** —— ' +
                '比如蛋炒饭你要是用现煮的饭,把「隔夜」清掉它就排得上了。',
          value: v.aheadOfTime || '', allowEmpty: true, emptyLabel: '不用提前准备',
          placeholder: '例:腌 15分钟 / 泡发 30分钟', back: true,
        }).then(function (t) {
          if (t === Modal.BACK) return Modal.BACK;
          if (t == null) return null;
          RecipeBook.save(r.id, { aheadOfTime: t || null }, v.prepLevel);
          return 'done';
        });
      }

      if (k === 'equip') return editEquipment(r);
      if (k === 'ing') return editIngredients(r, v);

      // 时间两项
      var isActive = k === 'active';
      return Modal.ask({
        title: isActive ? '你动手实际要多久?' : '从下锅到能吃多久?',
        hint: isActive
          ? '库里记 ' + v.activeMinutes + ' 分,是估的没测过。填你自己的,以后排菜按你的来。'
          : '库里记 ' + v.totalMinutes + ' 分。**不含提前腌/泡发的时间**,那个单独记。',
        type: 'number', suffix: '分钟', back: true,
        value: isActive ? v.activeMinutes : v.totalMinutes,
        presets: isActive ? null : [{ label: '和动手一样(不用等)', value: v.activeMinutes }],
      }).then(function (m) {
        if (m === Modal.BACK) return Modal.BACK;
        if (m == null) return null;
        var n = parseFloat(m);
        if (isNaN(n) || n < 0) return null;
        RecipeBook.save(r.id, isActive ? { activeMinutes: n } : { totalMinutes: n }, v.prepLevel);
        return 'done';
      });
    }

    loop();
  }

  /** 厨具 —— **多选**。
   *
   * ⚠️ 第一版只让选一个,而一道菜要「炒锅 + 蒸锅」是再正常不过的事,
   *    选了第二个就把第一个顶掉了。
   *    Modal.pick 本身是单选,所以做成「点一下切换、切换完重新打开」——
   *    列表上带 ☑ / ☐,点「就这些」收工。 */
  function editEquipment(r) {
    var cur = ((RecipeBook.overrideOf(r.id) || {}).equipmentRequired
               || r.equipmentRequired || []).slice();
    var owned = (config().equipment || []);
    var all = (Catalog.equipment() || []).filter(function (e) { return owned.indexOf(e) >= 0; });
    // 库里要求、但你没勾「我有」的,也得列出来 —— 否则改不掉它
    (r.equipmentRequired || []).forEach(function (e) { if (all.indexOf(e) < 0) all.push(e); });

    function loop() {
      return Modal.pick({
        title: '这道你用什么做?',
        hint: '库里记的是 ' + ((r.equipmentRequired || []).join(' + ') || '无要求') +
              '。可以多选 —— 点一下切换,改完点「就这些」。',
        back: true, backLabel: '返回(不保存)',
        options: all.map(function (e) {
          var on = cur.indexOf(e) >= 0;
          return { key: e, label: (on ? '☑ ' : '☐ ') + e,
                   hint: owned.indexOf(e) < 0 ? '你没有这样' : null };
        }).concat([{ key: '__ok', label: '就这些 · ' + (cur.join(' + ') || '不需要特殊厨具') }]),
      }).then(function (e) {
        if (e === Modal.BACK) return Modal.BACK;
        if (e == null) return null;
        if (e === '__ok') {
          RecipeBook.save(r.id, { equipmentRequired: cur });
          return 'done';
        }
        var i = cur.indexOf(e);
        if (i >= 0) cur.splice(i, 1); else cur.push(e);
        return loop();
      });
    }
    return loop();
  }

  /** 食材:改量 / 去掉 / 加一样。
   *  ⚠️ 只给「改克数」是不够的 —— 真实的调整多半是「这道我不放香菜」
   *     「我做红烧肉会加土豆」,那是增删不是改数。 */
  function editIngredients(r, v) {
    function cur() { return RecipeBook.overrideOf(r.id, v.prepLevel) || {}; }
    function live() {
      var rr = RECIPES.filter(function (x) { return x.id === r.id; })[0] || r;
      return (rr.variants || []).filter(function (x) { return x.prepLevel === v.prepLevel; })[0]
             || rr.variants[0];
    }

    function loop() {
      var vv = live();
      return Modal.pick({
        title: '食材 · ' + r.name,
        hint: '改了之后采购清单和营养核算都按你的来。',
        back: true,
        options: (vv.ingredients || []).map(function (it) {
          return { key: 'i:' + it.ids[0], label: it.names.join('/'),
                   hint: (it.qty || '?') + (it.unit || 'g') +
                         (it.userAdded ? ' · 你加的' : '') +
                         (it.role === 'main' ? ' · 主料' : '') };
        }).concat([{ key: '__add', label: '＋ 加一样', hint: '这道你会额外放什么' }]),
      }).then(function (k) {
        if (k === Modal.BACK) return Modal.BACK;
        if (!k) return null;
        if (k === '__add') return addOne().then(function (res) {
          return res === 'done' ? loop() : (res === Modal.BACK ? loop() : null);
        });
        return oneIngredient(k.slice(2)).then(function (res) {
          return res === 'done' ? loop() : (res === Modal.BACK ? loop() : null);
        });
      });
    }

    function addOne() {
      return Modal.ask({
        title: '加什么?',
        hint: '搜食材名。加进去之后它会出现在采购清单里。',
        placeholder: '例:土豆 / tudou', back: true,
      }).then(function (q2) {
        if (q2 === Modal.BACK) return Modal.BACK;
        if (!q2) return null;
        var hits = Search.find(q2, null, 8);
        if (!hits.total) {
          return Modal.note({
            title: '字典里没有「' + q2 + '」',
            body: '菜谱只能用字典里有的食材 —— 否则营养、包装规格、保质期全都算不出来。',
          }).then(function () { return Modal.BACK; });
        }
        return Modal.pick({
          title: '加哪个?', back: true,
          options: hits.hits.map(function (i) {
            return { key: i.id, label: i.name, hint: i.category || '' };
          }),
        }).then(function (id) {
          if (id === Modal.BACK) return addOne();
          if (!id) return null;
          var ing = Catalog.ingredient(id);
          return Modal.ask({
            title: ing.name + ' 放多少?', type: 'number', suffix: 'g', value: 100, back: true,
          }).then(function (g) {
            if (g === Modal.BACK) return addOne();
            if (g == null) return null;
            var n = parseFloat(g);
            if (isNaN(n) || n <= 0) return null;
            var add = (cur().add || []).slice();
            add.push({ id: id, grams: n, role: 'side' });
            RecipeBook.save(r.id, { add: add }, v.prepLevel);
            return 'done';
          });
        });
      });
    }

    function oneIngredient(id2) {
      var it = live().ingredients.filter(function (x) { return x.ids[0] === id2; })[0];
      if (!it) return Promise.resolve(Modal.BACK);
      return Modal.pick({
        title: it.names[0], back: true,
        options: [
          { key: 'qty', label: '改用量', hint: '现在 ' + (it.qty || '?') + (it.unit || 'g') },
          { key: 'del', label: '这道我不放它',
            hint: it.role === 'main' ? '这是主料,去掉之后这道菜会变样' : '从这道菜里去掉',
            danger: true },
        ],
      }).then(function (act) {
        if (act === Modal.BACK) return Modal.BACK;
        if (!act) return null;
        if (act === 'del') {
          var rm = (cur().remove || []).slice();
          if (rm.indexOf(id2) < 0) rm.push(id2);
          RecipeBook.save(r.id, { remove: rm }, v.prepLevel);
          return 'done';
        }
        return Modal.ask({
          title: it.names[0] + ' 你放多少?',
          hint: '改了之后采购清单和营养核算都按你这个数算。',
          type: 'number', suffix: it.unit || 'g', value: it.qty || it.grams, back: true,
        }).then(function (g) {
          if (g === Modal.BACK) return oneIngredient(id2);
          if (g == null) return null;
          var n = parseFloat(g);
          if (isNaN(n) || n <= 0) return null;
          var gm = Object.assign({}, cur().grams || {});
          gm[id2] = n;
          RecipeBook.save(r.id, { grams: gm }, v.prepLevel);
          return 'done';
        });
      });
    }

    return loop();
  }

  /** 往 list 里追加一道菜的行(展开时再追加详情块)。
   *
   * ⚠️ 返回元素而不是直接追加是不行的:.list-row 的分隔线靠
   *    `border-top` + `:first-child` 去掉第一条。要是每行外面再包一个 div,
   *    每个 wrapper 里的行都成了 :first-child,**所有分隔线一起消失**。
   *    所以行和它的详情块必须是列表的**同级**子节点。
   *
   * ⚠️ 行用 div 不用 button:展开的详情里有按钮,button 套 button 是非法 HTML,
   *    浏览器会自己把它拆开,布局直接乱掉。 */
  function dishRow(r, list) {
    var open = !!openD[r.id];
    var ok = doable(r);
    var head = h('div', {
      class: 'list-row',
      onclick: function () { openD[r.id] = !open; render(); },
    });
    head.appendChild(h('div', { class: 'body' }, [
      h('div', { class: 'ttl' + (ok ? '' : ' dim') }, [
        r.name,
        r.variants.length > 1
          ? h('span', { class: 'xs dim', style: 'margin-left:8px;font-weight:400' },
              [r.variants.length + ' 档'])
          : null,
      ]),
      h('div', { class: 'sub2' }, [attrLine(r, r.variants[0])]),
    ]));
    if (!ok) head.appendChild(h('span', { class: 'conf conf-C' }, ['做不了']));
    head.appendChild(h('span', { class: 'dim' }, [open ? '▴' : '▾']));
    list.appendChild(head);
    if (open) {
      list.appendChild(h('div', { style: 'padding:0 16px 16px' }, [detail(r)]));
    }
  }

  // ---------------- 搜索 ----------------

  /** ⚠️ 「收录了没有」必须给明确答案。搜不到就说没有,不要静悄悄返回空列表。 */
  function renderSearch(w) {
    var ql = q.toLowerCase();
    var isPy = Pinyin.looksPinyin(q);

    function hitName(r) {
      return r.name.toLowerCase().indexOf(ql) >= 0 || (isPy && Pinyin.match(r.name, ql));
    }
    var byName = dishes().filter(hitName);
    var byIng = dishes().filter(function (r) {
      if (byName.indexOf(r) >= 0) return false;
      return (r.variants || []).some(function (v) {
        return (v.ingredients || []).some(function (it) {
          return it.names.some(function (n) {
            return n.toLowerCase().indexOf(ql) >= 0 || (isPy && Pinyin.match(n, ql));
          });
        });
      });
    });

    if (!byName.length) {
      w.appendChild(h('div', { class: 'note warn' }, [
        '**库里没有叫「' + q + '」的菜。**' +
        (byIng.length ? '不过有 ' + byIng.length + ' 道菜用到它。' : ''),
      ]));
    }

    if (byName.length) {
      w.appendChild(h('div', { class: 'hint' }, ['菜名匹配 ' + byName.length + ' 道']));
      var c1 = h('div', { class: 'list' });
      byName.slice(0, 40).forEach(function (r) { dishRow(r, c1); });
      w.appendChild(c1);
      if (byName.length > 40) {
        w.appendChild(h('div', { class: 'hint', style: 'text-align:center' },
          ['还有 ' + (byName.length - 40) + ' 道,搜具体点']));
      }
    }

    if (byIng.length) {
      w.appendChild(h('div', { class: 'hint', style: 'margin-top:12px' },
        ['用到「' + q + '」的 ' + byIng.length + ' 道']));
      var c2 = h('div', { class: 'list' });
      byIng.slice(0, 30).forEach(function (r) { dishRow(r, c2); });
      w.appendChild(c2);
      if (byIng.length > 30) {
        w.appendChild(h('div', { class: 'hint', style: 'text-align:center' },
          ['还有 ' + (byIng.length - 30) + ' 道']));
      }
    }
  }

  /** 被排除的菜 —— **按原因分组**,而不是按菜系。
   *
   *  这一屏要回答的是「我该去改哪条设置」,所以第一层必须是原因:
   *  「厨具不够 165 道」比「川湘云贵 40 道」有用得多。
   *  过滤和原因都走 Catalog.explain(),和求解器同一套判断 ——
   *  报告和实际排菜不一致是最难查的那种 bug。 */
  function renderBlocked(w, all) {
    var cfg = config();
    var byWhy = {};
    all.forEach(function (r) {
      var e = Catalog.explain(r, cfg);
      if (e.ok) return;
      // 一道菜所有档位都被拦,取第一档的第一条原因当代表,并抹掉具体数字好归类
      var first = (e.variants[0] && e.variants[0].reasons[0]) || '未知';
      var key = first.replace(/[((].*$/, '').replace(/\d+/g, 'N').trim();
      (byWhy[key] = byWhy[key] || []).push(e);
    });

    var keys = Object.keys(byWhy).sort(function (a, b) {
      return byWhy[b].length - byWhy[a].length;
    });
    if (!keys.length) {
      w.appendChild(h('div', { class: 'note' }, ['当前设置下没有被排除的菜。']));
      return;
    }

    var top = keys[0];
    w.appendChild(h('div', { class: 'note' }, [
      '最大的一条是「**' + top + '**」,占 ' + byWhy[top].length + ' 道。' +
      '想放宽去「我的 → 厨房与口味」。',
    ]));

    var whyList = h('div', { class: 'list' });
    keys.forEach(function (k) {
      var rows = byWhy[k];
      var open = !!openG[k];
      var card = whyList;
      card.appendChild(h('div', {
        class: 'list-row',
        onclick: function () { openG[k] = !open; render(); },
      }, [
        h('div', { class: 'body' }, [h('div', { class: 'ttl' }, [k])]),
        h('span', { class: 'xs dim' }, [rows.length + ' 道']),
        h('span', { class: 'dim' }, [open ? '▴' : '▾']),
      ]));
      if (open) {
        rows.slice().sort(function (a, b) {
          return a.recipe.name.localeCompare(b.recipe.name, 'zh');
        }).forEach(function (e) {
          // ⚠️ 这里用 dishRow,不自己画一行。
          //    排除页最该能点进去看和改 —— 你看到「难度 5,超过 3」,
          //    下一步想的就是「那这道到底是什么」和「能不能按我的情况调」。
          //    第一版只画了菜名 + 原因,是个死胡同:看见了却什么也做不了。
          dishRow(e.recipe, card);
          // 排除原因跟在那一行下面。dishRow 现在直接往容器里追加,
          // 所以这条也得是容器的同级子节点 —— 行本身是 flex,塞进去会被挤扁。
          card.appendChild(h('div', {
            class: 'xs',
            style: 'color:var(--warn);padding:0 16px 8px',
          }, [
            e.variants.map(function (v) {
              return v.prepLevel + ':' + v.reasons.join(' / ');
            }).join('    |    '),
          ]));
        });
      }
    });
    w.appendChild(whyList);
  }

  /** render() 会把整棵子树重建,输入框跟着被销毁 —— 焦点和光标位置一起没。
   *  给输入框一个稳定 id,重建后按 id 找回来并恢复光标位置。
   *  (中文输入法的组字状态救不回来,那个靠 composition 事件挡住重渲染。) */
  function keepFocus(fn) {
    var a = document.activeElement;
    var id = a && a.attrs ? a.attrs.id : (a && a.id);
    var ss = null, se = null;
    if (id && a.tagName === 'INPUT') {
      try { ss = a.selectionStart; se = a.selectionEnd; } catch (e) {}
    }
    fn();
    if (!id) return;
    var n = el.querySelector('#' + id);
    if (!n) return;
    n.focus();
    if (ss != null) { try { n.setSelectionRange(ss, se); } catch (e) {} }
  }

  function render() { keepFocus(doRender); }

  function doRender() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });
    var all = dishes();

    w.appendChild(h('h1', {}, ['菜谱']));
    // ⚠️ 副标题原来把「半成品是什么」和「时间难度是估的」两件事都塞进来了 ——
    //    第一件在下面分组里点开就明白,第二件在每道菜的详情页说更合适。
    //    第一屏只报规模。
    w.appendChild(h('p', { class: 'sub' }, [
      all.length + ' 道菜 · ' + preps().length + ' 个半成品 · 时间难度都是估的',
    ]));

    // ⚠️ 中文输入法必须挡住组字期间的重渲染。
    //    IME 打字时先进「组字」状态(拼音还没上屏),这期间每敲一个字母都触发
    //    oninput → 整页重建 → **输入框被销毁,组字会话跟着被杀**。
    //    表现是:英文能打,中文一个字都打不进去。
    //    keepFocus 救不了这个 —— 焦点回来了,但组字状态已经没了。
    w.appendChild(h('div', { class: 'row' }, [
      h('input', {
        id: 'rec-q', type: 'text', value: q,
        placeholder: '搜菜名或食材…… 红烧肉 / hongshaorou / hsr',
        oncompositionstart: function () { composing = true; },
        oncompositionend: function (e) {
          composing = false;
          q = e.target.value.trim(); render();
        },
        oninput: function (e) {
          if (composing) return;            // 组字中,等 compositionend 再说
          q = e.target.value.trim(); render();
        },
      }),
    ]));

    if (q) { renderSearch(w); el.appendChild(w); return; }

    w.appendChild(h('div', { class: 'seg', style: 'margin-bottom:12px' },
      [['file', '按菜系'], ['method', '按做法'], ['flavor', '按味型']].map(function (o) {
        return h('button', {
          type: 'button', 'aria-pressed': String(groupBy === o[0]),
          onclick: function () { groupBy = o[0]; openG = {}; render(); },
        }, [o[1]]);
      })));

    // 「我现在能做的」是这个 app 相对一本菜谱书的全部优势 —— 放在能一键切换的位置。
    //
    // ⚠️ 第三档「排除的」是必须的:光告诉你「还有 209 道做不了」没有用,
    //    你会想知道**为什么** —— 是厨具不够、太难、还是要隔夜。
    //    知道原因才知道该去改哪条设置,否则那个数字只是让人焦虑。
    var doableCount = all.filter(doable).length;
    var blocked = all.length - doableCount;
    w.appendChild(h('div', { class: 'chips', style: 'margin-bottom:12px' },
      [['all', '全部 ' + all.length], ['can', '我能做的 ' + doableCount],
       ['cant', '排除的 ' + blocked + ' · 看原因']].map(function (o) {
        return h('button', {
          type: 'button', 'aria-pressed': String(view === o[0]),
          onclick: function () { view = o[0]; openG = {}; render(); },
        }, [o[1]]);
      })));

    if (view === 'cant') { renderBlocked(w, all); el.appendChild(w); return; }

    var pool = view === 'can' ? all.filter(doable) : all;
    var groups = {};
    pool.forEach(function (r) { (groups[keyOf(r)] = groups[keyOf(r)] || []).push(r); });
    var keys = Object.keys(groups).sort(function (a, b) {
      return groups[b].length - groups[a].length;
    });

    // ⚠️ 原来**每个分组一张 .card** —— 十几个菜系就是十几个带边框和阴影的盒子,
    //    和采购清单那边一样的毛病。分组是一份清单的几段,不是十几张卡片。
    //    一个 .list 容器,组标题和菜名都是行。
    var list = h('div', { class: 'list' });
    keys.forEach(function (k) {
      var open = !!openG[k];
      list.appendChild(h('button', {
        type: 'button', class: 'list-row',
        onclick: function () { openG[k] = !open; render(); },
      }, [
        h('div', { class: 'body' }, [h('div', { class: 'ttl' }, [k])]),
        h('span', { class: 'xs dim' }, [groups[k].length + ' 道']),
        h('span', { class: 'dim' }, [open ? '▴' : '▾']),
      ]));
      if (open) {
        groups[k].slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); })
          .forEach(function (r) { dishRow(r, list); });
      }
    });
    w.appendChild(list);

    el.appendChild(w);
  }

  /** ⚠️ 每次进这一页都清空搜索词。
   *    不清的话:你搜了「红烧肉」,切去库存再切回来,还停在搜索结果里,
   *    看起来像菜谱库只剩三道菜。分组展开状态留着(那是你翻到哪儿了),
   *    搜索词不留(那是一次性的意图)。 */
  function mount(node) { el = node; q = ''; render(); }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = RecipesUI;
