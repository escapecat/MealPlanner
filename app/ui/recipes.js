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

  var el, q = '', groupBy = 'file', openG = {}, openD = {}, onlyDoable = false,
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

  function chip(text, kind) {
    var st = 'font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid var(--border);';
    if (kind === 'main') st += 'background:var(--accent-dim);color:var(--accent);font-weight:600';
    else if (kind === 'dashed') st = st.replace('solid', 'dashed') + 'color:var(--text-dim)';
    else st += 'color:var(--text-dim)';
    return h('span', { style: st }, [text]);
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

      var line = h('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;margin-top:6px' });
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
        box.appendChild(h('div', { style: 'display:flex;gap:5px;flex-wrap:wrap;margin-top:6px' },
          v.seasonings.map(function (it) {
            var have = it.ids.some(function (id) { return Pantry.hasStaple(id); });
            return h('span', {
              style: 'font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid ' +
                     (have ? 'var(--border);color:var(--text-dim)'
                           : 'var(--warn);color:var(--warn)'),
            }, [it.names.join('/') + (have ? '' : ' 没有')]);
          })));
      }

      if (nu) {
        box.appendChild(h('div', { class: 'hint', style: 'margin-top:6px' }, [
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
    });

    box.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' }, [
      r.id + ' · ' + (CUISINE[r.file] || r.file) + ' · ' + (r.flavor || []).join('/') +
      ' · 厨具 ' + ((r.equipmentRequired || []).join('/') || '无要求') +
      // 全库 verified 都是 false,不标出来就等于默认它是核实过的
      ' · 数据未核实',
    ]));

    box.appendChild(h('a', {
      class: 'btn ghost',
      style: 'width:auto;padding:5px 12px;font-size:13px;text-decoration:none;' +
             'display:inline-block;margin-top:8px',
      href: 'https://www.xiachufang.com/search/?keyword=' + encodeURIComponent(r.name),
      target: '_blank', rel: 'noopener',
    }, ['搜做法 ↗']));
    return box;
  }

  function dishRow(r) {
    var open = !!openD[r.id];
    var ok = doable(r);
    var row = h('div', { style: 'padding:9px 0;border-bottom:1px solid var(--border)' });

    var head = h('div', {
      style: 'display:flex;gap:8px;align-items:baseline;cursor:pointer',
      onclick: function () { openD[r.id] = !open; render(); },
    });
    head.appendChild(h('div', { style: 'flex:1' + (ok ? '' : ';color:var(--text-dim)') }, [
      r.name,
      r.variants.length > 1
        ? h('span', { class: 'hint', style: 'margin-left:6px' }, [r.variants.length + ' 档'])
        : null,
    ]));
    if (!ok) head.appendChild(h('span', { class: 'conf conf-C' }, ['做不了']));
    head.appendChild(h('span', { style: 'color:var(--text-dim);flex:0 0 auto' }, [open ? '▴' : '▾']));
    row.appendChild(head);
    row.appendChild(h('div', { class: 'hint' }, [attrLine(r, r.variants[0])]));
    if (open) row.appendChild(detail(r));
    return row;
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
      var c1 = h('div', { class: 'card', style: 'padding:2px 14px' });
      byName.slice(0, 40).forEach(function (r) { c1.appendChild(dishRow(r)); });
      w.appendChild(c1);
      if (byName.length > 40) {
        w.appendChild(h('div', { class: 'hint', style: 'text-align:center' },
          ['还有 ' + (byName.length - 40) + ' 道,搜具体点']));
      }
    }

    if (byIng.length) {
      w.appendChild(h('div', { class: 'hint', style: 'margin-top:12px' },
        ['用到「' + q + '」的 ' + byIng.length + ' 道']));
      var c2 = h('div', { class: 'card', style: 'padding:2px 14px' });
      byIng.slice(0, 30).forEach(function (r) { c2.appendChild(dishRow(r)); });
      w.appendChild(c2);
      if (byIng.length > 30) {
        w.appendChild(h('div', { class: 'hint', style: 'text-align:center' },
          ['还有 ' + (byIng.length - 30) + ' 道']));
      }
    }
  }

  // ---------------- 页面 ----------------

  function keepFocus(fn) {
    var a = document.activeElement;
    var id = a && a.id, ss = null, se = null;
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
    w.appendChild(h('p', { class: 'sub' }, [
      all.length + ' 道菜 · ' + preps().length + ' 个半成品(泡菜/红油/高汤这类,做完进库存供别的菜用)。' +
      '时间和难度都是估的,没核实过。',
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

    w.appendChild(h('div', { class: 'seg', style: 'margin-bottom:10px' },
      [['file', '按菜系'], ['method', '按做法'], ['flavor', '按味型']].map(function (o) {
        return h('button', {
          type: 'button', 'aria-pressed': String(groupBy === o[0]),
          onclick: function () { groupBy = o[0]; openG = {}; render(); },
        }, [o[1]]);
      })));

    // 「我现在能做的」是这个 app 相对一本菜谱书的全部优势 —— 放在能一键切换的位置
    var doableCount = all.filter(doable).length;
    w.appendChild(h('div', { class: 'chips', style: 'margin-bottom:12px' }, [
      h('button', {
        type: 'button', 'aria-pressed': String(onlyDoable),
        onclick: function () { onlyDoable = !onlyDoable; render(); },
      }, ['只看我能做的 ' + doableCount]),
    ]));
    if (doableCount < all.length) {
      w.appendChild(h('div', { class: 'hint', style: 'margin:-6px 0 12px' }, [
        '另外 ' + (all.length - doableCount) + ' 道受厨具 / 忌口 / 耗时上限限制 —— 去「我的」放宽。',
      ]));
    }

    var pool = onlyDoable ? all.filter(doable) : all;
    var groups = {};
    pool.forEach(function (r) { (groups[keyOf(r)] = groups[keyOf(r)] || []).push(r); });
    var keys = Object.keys(groups).sort(function (a, b) {
      return groups[b].length - groups[a].length;
    });

    keys.forEach(function (k) {
      var open = !!openG[k];
      var card = h('div', { class: 'card', style: 'padding:2px 14px' });
      card.appendChild(h('div', {
        style: 'display:flex;gap:8px;align-items:center;padding:11px 0;cursor:pointer' +
               (open ? ';border-bottom:1px solid var(--border)' : ''),
        onclick: function () { openG[k] = !open; render(); },
      }, [
        h('div', { style: 'flex:1;font-weight:600' }, [k]),
        h('span', { class: 'hint' }, [groups[k].length + ' 道']),
        h('span', { style: 'color:var(--text-dim)' }, [open ? '▴' : '▾']),
      ]));
      if (open) {
        groups[k].slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'zh'); })
          .forEach(function (r) { card.appendChild(dishRow(r)); });
      }
      w.appendChild(card);
    });

    el.appendChild(w);
  }

  function mount(node) { el = node; render(); }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = RecipesUI;
