// 「库存」页 —— 调料储物柜(有/没有 + 开封追踪)+ 冰箱(定量)。
//
// 判据:**会被吃掉的东西在这里,不会被吃掉的在「我的」。**
//
// 两块的交互完全不同,因为两种库存的性质不同:
//   调料:勾选式。你不会去称还剩多少盐,但开封后放多久很要紧。
//   生鲜:自动式。采购清单勾「已买」自动入库,某顿点「完成」自动扣减 —— 零手动录入。

var PantryUI = (function () {

  var el, tab = 'staples', q = '', showAll = false;

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function now() { return new Date().toISOString(); }

  // ---------------- 调料储物柜 ----------------

  function alertsCard() {
    var al = Pantry.stapleAlerts(now());
    if (!al.length) return null;
    var box = h('div', { class: 'card' });
    box.appendChild(h('div', { style: 'font-weight:600;margin-bottom:6px' }, ['该处理的']));
    al.forEach(function (a) {
      box.appendChild(h('div', { class: a.expired ? 'note warn' : 'note',
                                 style: 'margin-bottom:8px' }, [
        a.name + ' —— ' +
        (a.expired ? '开封已超过 ' + a.openedShelfLifeDays + ' 天(过了 ' + (-a.daysLeft) + ' 天)'
                   : '还有 ' + a.daysLeft + ' 天到期') +
        (a.usedInDishes ? '。库里有 ' + a.usedInDishes + ' 道菜用它,下次可以优先排。' : '。'),
      ]));
    });
    return box;
  }

  function stapleRow(ing) {
    var has = Pantry.hasStaple(ing.id);
    var entry = Pantry.stapleEntry(ing.id);
    var track = Pantry.worthTrackingOpened(ing);
    var box = h('div', { class: 'card', style: 'padding:10px 12px' });

    var head = h('div', { style: 'display:flex;align-items:center;gap:10px' });
    head.appendChild(h('button', {
      type: 'button', class: 'chips',
      style: 'flex:0 0 auto;padding:0;border:0;background:none;font-size:20px;cursor:pointer',
      onclick: function () { Pantry.toggleStaple(ing.id); render(); },
    }, [has ? '☑' : '☐']));
    head.appendChild(h('div', { style: 'flex:1;min-width:0' }, [
      h('div', { style: has ? '' : 'color:var(--text-dim)' }, [ing.name]),
      h('div', { class: 'hint' }, [
        (ing.packaging || '规格未填') +
        (ing.openedShelfLifeDays ? ' · 开封后 ' + ing.openedShelfLifeDays + ' 天' : '') +
        (ing.inevitableSurplus ? ' · ⚠️ 单人多半吃不完' : ''),
      ]),
    ]));
    box.appendChild(head);

    // 只对开封后短保的品类才问开封时间 —— 盐糖问了是噪音
    if (has && track) {
      var opened = entry && entry.openedAt;
      var line = h('div', { style: 'margin-top:8px;display:flex;gap:6px;align-items:center;flex-wrap:wrap' });
      line.appendChild(h('span', { class: 'hint' }, ['开封时间:']));
      line.appendChild(h('input', {
        type: 'date',
        value: opened ? opened.slice(0, 10) : '',
        onchange: function (e) {
          Pantry.setOpened(ing.id, e.target.value ? new Date(e.target.value).toISOString() : null);
          render();
        },
      }));
      if (!opened) {
        line.appendChild(h('button', {
          class: 'btn ghost', style: 'width:auto;padding:5px 10px;font-size:12px',
          onclick: function () { Pantry.setOpened(ing.id, now()); render(); },
        }, ['今天刚开']));
        line.appendChild(h('span', { class: 'hint' }, ['(没开封就留空)']));
      }
      box.appendChild(line);
    }
    return box;
  }

  function renderStaples(w) {
    Pantry.ensureInit();

    var al = alertsCard();
    if (al) w.appendChild(al);

    var owned = (Pantry.staples() || []).length;
    w.appendChild(h('div', { class: 'note' }, [
      '已有 ' + owned + ' 样。**调料不进每周采购清单** —— 只在没有、或者开封快过期时提醒你。',
    ]));

    w.appendChild(h('div', { class: 'row' }, [
      h('input', {
        type: 'text', placeholder: '搜调料…… 例:豆瓣 / 生抽 / 咖喱',
        value: q,
        oninput: function (e) { q = e.target.value.trim(); render(); },
      }),
    ]));

    // 值得买的:和厨具的边际价值同一个思路 —— 回答「值不值得添这瓶」
    if (!q) {
      var sug = Pantry.suggestUnlocks(6);
      if (sug.length) {
        var box = h('div', { class: 'card' });
        box.appendChild(h('div', { style: 'font-weight:600;margin-bottom:6px' },
          ['添这几样能多做最多菜']));
        sug.forEach(function (s) {
          var r = h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px' });
          r.appendChild(h('button', {
            class: 'btn ghost', style: 'width:auto;padding:5px 10px;font-size:13px;flex:0 0 auto',
            onclick: function () { Pantry.toggleStaple(s.id); render(); },
          }, ['+ ' + s.name]));
          r.appendChild(h('span', { class: 'hint', style: 'flex:1' }, [
            '解锁 ' + s.dishes + ' 道' +
            (s.inevitableSurplus ? ' · ⚠️ 最小规格单人吃不完' : ''),
          ]));
          box.appendChild(r);
        });
        w.appendChild(box);
      }
    }

    var pool = INGREDIENTS.filter(function (i) { return i.tier === 'staple'; });
    var rows = pool.filter(function (i) {
      if (q) {
        var hay = i.name + ' ' + i.id + ' ' + (i.aliases || []).join(' ');
        return hay.toLowerCase().indexOf(q.toLowerCase()) >= 0;
      }
      return showAll || Pantry.hasStaple(i.id);
    });

    if (!q) {
      w.appendChild(h('button', {
        class: 'btn ghost', style: 'margin-bottom:10px',
        onclick: function () { showAll = !showAll; render(); },
      }, [showAll ? '只看我有的' : '看全部 ' + pool.length + ' 种(按需勾选)']));
    }

    if (!rows.length) {
      w.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['🧂']),
        h('div', {}, [q ? '没找到「' + q + '」' : '一样都没勾']),
      ]));
      return;
    }
    rows.slice(0, 80).forEach(function (i) { w.appendChild(stapleRow(i)); });
    if (rows.length > 80) {
      w.appendChild(h('div', { class: 'hint', style: 'text-align:center' },
        ['还有 ' + (rows.length - 80) + ' 种,用搜索缩小范围']));
    }
  }

  // ---------------- 冰箱(定量)----------------

  function renderFridge(w) {
    var its = Pantry.items();
    if (!its.length) {
      w.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['🧊']),
        h('div', { style: 'font-weight:600;margin-bottom:8px' }, ['冰箱还是空的']),
      ]));
      w.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'hint' }, [
          '这里**不用手动录**。采购清单上勾「已买」会按包装规格自动入库,',
        ]),
        h('div', { class: 'hint' }, [
          '某顿点「完成」自动按用量扣减,调料第一次被用到自动记开封时间。',
        ]),
        h('div', { class: 'hint', style: 'margin-top:8px' }, [
          '要手动管库存的话,三周就没人用了 —— 所有变动都搭在你本来就会做的操作上。',
        ]),
      ]));
      return;
    }

    var soon = Pantry.expiringSoon(3, now());
    if (soon.length) {
      w.appendChild(h('div', { class: 'note warn' }, [
        soon.length + ' 样快过期了,下次生成会优先排掉它们。',
      ]));
    }
    its.forEach(function (it) {
      var ing = Catalog.ingredient(it.ingredientId);
      var days = it.expiresAt
        ? Math.round((Date.parse(it.expiresAt) - Date.parse(now())) / 864e5) : null;
      w.appendChild(h('div', { class: 'card' }, [
        h('div', { style: 'font-weight:600' }, [(ing ? ing.name : it.ingredientId)]),
        h('div', { class: 'hint' }, [
          Math.round(it.amount) + (it.unit || 'g') + ' · ' +
          ({ fridge: '冷藏', freezer: '冷冻', pantry: '常温' }[it.location] || it.location) +
          (days != null ? ' · ' + (days < 0 ? '已过期' : days + ' 天后过期') : ''),
        ]),
      ]));
    });
  }

  // ---------------- 页面 ----------------

  function render() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });
    w.appendChild(h('h1', {}, ['库存']));

    w.appendChild(h('div', { class: 'seg', style: 'margin-bottom:14px' },
      [['staples', '调料柜'], ['fridge', '冰箱']].map(function (t) {
        return h('button', {
          type: 'button', 'aria-pressed': String(tab === t[0]),
          onclick: function () { tab = t[0]; q = ''; render(); },
        }, [t[1]]);
      })));

    if (tab === 'staples') renderStaples(w); else renderFridge(w);
    el.appendChild(w);
  }

  function mount(node) { el = node; render(); }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = PantryUI;
