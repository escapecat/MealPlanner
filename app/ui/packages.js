// 包装规格:默认值 + 用户增删改
//
// 为什么这一页优先级高:全库包装规格 99.3% 未经原文核实(A 级只有 1 条)。
// 求解器的核心是算「买 300g 用 180g,剩 120g 下顿吃掉」—— 输入是估的,
// 算出来的「零浪费」就是假的。
//
// 三层数据,合并后对外只暴露 merged():
//   PACKAGES            生成的默认值,重新跑 build_data.py 会被覆盖
//   packageOverrides    用户对默认条目的修改,**永不被覆盖**
//   userPackages        用户自己加的条目(库里根本没有的商品)
//   hiddenPackages      用户隐藏掉的默认条目(买不到 / 不相干)

var PackagesUI = (function () {

  var el, q = '', filter = 'all', editing = null, adding = null, ingQ = '';

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

  function overrides() { return Store.get('packageOverrides', {}) || {}; }
  function userPkgs()  { return Store.get('userPackages', []) || []; }
  function hidden()    { return Store.get('hiddenPackages', []) || []; }

  /** 全应用读包装规格的唯一入口 */
  function merged() {
    var ov = overrides(), hid = hidden();
    var base = PACKAGES.filter(function (p) { return hid.indexOf(p.id) < 0; })
      .map(function (p) {
        var o = ov[p.id];
        return o ? Object.assign({}, p, o, { userEdited: true }) : p;
      });
    return base.concat(userPkgs().map(function (p) {
      return Object.assign({}, p, { userAdded: true, userEdited: true });
    }));
  }

  function isUser(p) { return !!p.userAdded; }

  function savePatch(id, patch, user) {
    if (user) {
      var list = userPkgs();
      var i = list.findIndex(function (x) { return x.id === id; });
      if (i >= 0) list[i] = Object.assign({}, list[i], patch, { editedAt: new Date().toISOString() });
      Store.set('userPackages', list);
    } else {
      var ov = overrides();
      ov[id] = Object.assign({}, ov[id] || {}, patch, {
        confidence: 'A',                 // 用户亲眼核对过 = 最高可信度
        editedAt: new Date().toISOString(),
      });
      Store.set('packageOverrides', ov);
    }
  }

  function resetOne(id) {
    var ov = overrides(); delete ov[id]; Store.set('packageOverrides', ov);
  }

  function removeOne(p) {
    if (isUser(p)) {
      Store.set('userPackages', userPkgs().filter(function (x) { return x.id !== p.id; }));
    } else {
      var hid = hidden(); hid.push(p.id); Store.set('hiddenPackages', hid);
      resetOne(p.id);
    }
  }

  function confBadge(c) {
    var label = { A: 'A 已核对', B: 'B 较可靠', C: 'C 估计值' }[c] || 'C 估计值';
    return h('span', { class: 'conf conf-' + (c || 'C') }, [label]);
  }

  // ---------------- 编辑面板(名字/规格/单位/售卖方式/价格 全都能改)----------------

  var SELL_MODES = ['定量预包装', '整颗计件', '散称'];
  var UNITS = ['g', 'ml', '只', '个', '片', '张', '袋', '盒', '瓶', '把'];

  function field(label, node, hint) {
    return h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, [label]), node,
      hint ? h('div', { class: 'hint' }, [hint]) : h('span', {}),
    ]);
  }

  function textInput(value, onchange, placeholder) {
    return h('input', {
      type: 'text', value: value == null ? '' : String(value), placeholder: placeholder || '',
      oninput: function (e) { onchange(e.target.value); },
    });
  }

  function numInput(value, onchange, placeholder) {
    return h('input', {
      type: 'number', inputmode: 'decimal', placeholder: placeholder || '',
      value: value == null ? '' : String(value),
      oninput: function (e) {
        var v = parseFloat(e.target.value);
        onchange(isNaN(v) ? null : v);
      },
    });
  }

  function pills(options, get, set) {
    return h('div', { class: 'chips' }, options.map(function (o) {
      return h('button', {
        type: 'button', 'aria-pressed': String(get() === o),
        onclick: function () { set(o); render(); },
      }, [o]);
    }));
  }

  function editForm(p, draft, onSave, onCancel) {
    var box = h('div', { class: 'card' });
    box.appendChild(h('div', { style: 'font-weight:600;margin-bottom:10px' },
      [p ? '改这一条' : '加一条你自己的']));

    box.appendChild(field('商品名',
      textInput(draft.name, function (v) { draft.name = v; }, '盒马 日日鲜 鸡小胸'),
      '写你在货架上认得出的名字'));

    box.appendChild(field('对应哪种食材',
      h('div', {}, [
        h('input', {
          type: 'text', placeholder: '搜食材名…… 例:鸡胸 / 上海青',
          value: ingQ,
          oninput: function (e) { ingQ = e.target.value.trim(); renderIngHits(draft); },
        }),
        h('div', { id: 'inghits', style: 'margin-top:6px' }),
      ]),
      draft.ingredientId
        ? ('已选:' + (Catalog.ingredient(draft.ingredientId) || {}).name + ' [' + draft.ingredientId + ']')
        : '必选 —— 求解器靠它把商品和菜谱里的食材对上'));

    var g = h('div', { style: 'display:flex;gap:10px' });
    g.appendChild(h('div', { style: 'flex:2' }, [
      h('label', { class: 'lab' }, ['净含量']),
      numInput(draft.netWeight, function (v) { draft.netWeight = v; }, '300'),
    ]));
    g.appendChild(h('div', { style: 'flex:1' }, [
      h('label', { class: 'lab' }, ['单位']),
      h('select', {
        onchange: function (e) { draft.unit = e.target.value; },
      }, UNITS.map(function (u) {
        return h('option', { value: u, selected: draft.unit === u ? 'selected' : null }, [u]);
      })),
    ]));
    box.appendChild(h('div', { class: 'row' }, [g]));

    box.appendChild(field('价格(元)',
      numInput(draft.price, function (v) { draft.price = v; }, '没填过'),
      '填了以后才能算这次采购多少钱'));

    box.appendChild(field('售卖方式',
      pills(SELL_MODES, function () { return draft.sellMode; },
            function (v) { draft.sellMode = v; }),
      '整颗计件的东西(白菜/西瓜)重量不固定,求解器会另算'));

    box.appendChild(field('备注',
      textInput(draft.note, function (v) { draft.note = v; }, '可留空'), null));

    box.appendChild(h('button', {
      class: 'btn', style: 'margin-top:8px',
      onclick: function () {
        if (!draft.name || !draft.name.trim()) { alert('给它起个名字'); return; }
        if (!draft.ingredientId) { alert('要选对应哪种食材,不然求解器对不上'); return; }
        if (!draft.netWeight) { alert('净含量不能空'); return; }
        onSave(draft);
      },
    }, ['保存']));
    box.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:8px', onclick: onCancel,
    }, ['取消']));
    return box;
  }

  function renderIngHits(draft) {
    var host = el.querySelector('#inghits');
    if (!host) return;
    host.innerHTML = '';
    if (!ingQ) return;
    var hits = INGREDIENTS.filter(function (i) {
      var hay = i.name + ' ' + i.id + ' ' + (i.aliases || []).join(' ');
      return hay.toLowerCase().indexOf(ingQ.toLowerCase()) >= 0;
    }).slice(0, 8);
    if (!hits.length) {
      host.appendChild(h('div', { class: 'hint' },
        ['没找到「' + ingQ + '」。字典里没有的食材,现在还加不了 —— 先挑个最接近的。']));
      return;
    }
    host.appendChild(h('div', { class: 'chips' }, hits.map(function (i) {
      return h('button', {
        type: 'button', 'aria-pressed': String(draft.ingredientId === i.id),
        onclick: function () { draft.ingredientId = i.id; render(); },
      }, [i.name]);
    })));
  }

  // ---------------- 卡片 ----------------

  function card(p) {
    if (editing === p.id) {
      var draft = Object.assign({}, p);
      return editForm(p, draft, function (d) {
        savePatch(p.id, {
          name: d.name, ingredientId: d.ingredientId, netWeight: d.netWeight,
          unit: d.unit, price: d.price, sellMode: d.sellMode, note: d.note,
        }, isUser(p));
        editing = null; ingQ = ''; render();
      }, function () { editing = null; ingQ = ''; render(); });
    }

    var ing = Catalog.ingredient(p.ingredientId);
    var box = h('div', { class: 'card' });

    box.appendChild(h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
      h('strong', {}, [p.name || (ing ? ing.name : p.ingredientId)]),
      confBadge(p.confidence),
      p.userAdded ? h('span', { class: 'conf conf-A' }, ['自己加的'])
                  : (p.userEdited ? h('span', { class: 'conf conf-A' }, ['你改过']) : h('span', {})),
    ]));
    box.appendChild(h('div', { class: 'hint' }, [
      (ing ? ing.name : '⚠️ 食材对不上') + ' · ' +
      (p.netWeight != null ? p.netWeight + (p.unit || 'g') : '规格未填') +
      (p.price != null ? ' · ' + p.price + ' 元' : ' · 价格未填') +
      (p.sellMode ? ' · ' + p.sellMode : ''),
    ]));
    if (p.note) box.appendChild(h('div', { class: 'hint' }, [p.note]));

    var row = h('div', { style: 'display:flex;gap:8px;margin-top:10px' });
    row.appendChild(h('button', {
      class: 'btn ghost', style: 'padding:7px;font-size:13px',
      onclick: function () { editing = p.id; ingQ = ''; render(); },
    }, ['修改']));
    if (p.userEdited && !p.userAdded) {
      row.appendChild(h('button', {
        class: 'btn ghost', style: 'padding:7px;font-size:13px',
        onclick: function () { resetOne(p.id); render(); },
      }, ['恢复默认']));
    }
    row.appendChild(h('button', {
      class: 'btn ghost', style: 'padding:7px;font-size:13px',
      onclick: function () {
        if (confirm(isUser(p) ? '删掉这条?' : '隐藏这条?(不会真删,以后能在「已隐藏」里找回)')) {
          removeOne(p); render();
        }
      },
    }, [isUser(p) ? '删除' : '隐藏']));
    box.appendChild(row);
    return box;
  }

  // ---------------- 页面 ----------------

  function render() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });
    var all = merged();
    var verified = all.filter(function (p) { return p.confidence === 'A'; }).length;
    var hid = hidden().length;

    w.appendChild(h('h1', {}, ['包装规格']));
    w.appendChild(h('p', { class: 'sub' }, [
      '默认值大部分没核实过。你在超市看到实际规格,顺手改一下 —— 求解器算「剩多少」全靠它准。',
    ]));

    w.appendChild(h('div', { class: verified < all.length * 0.1 ? 'note warn' : 'note' }, [
      '已核对 ' + verified + ' / ' + all.length + ' 条' + (hid ? ' · 隐藏了 ' + hid + ' 条' : '') +
      '。没核对的按估计值算,采购量可能偏差。',
    ]));

    if (adding) {
      w.appendChild(h('div', { id: 'addform' }));
      el.appendChild(w);
      var host = el.querySelector('#addform');
      host.appendChild(editForm(null, adding, function (d) {
        var list = userPkgs();
        list.push({
          id: 'UP-' + Date.now(),
          ingredientId: d.ingredientId, name: d.name,
          netWeight: d.netWeight, unit: d.unit || 'g',
          sellMode: d.sellMode || '定量预包装',
          price: d.price, note: d.note,
          confidence: 'A',                       // 自己加的就是自己见过的
          vendor: null, createdAt: new Date().toISOString(),
        });
        Store.set('userPackages', list);
        adding = null; ingQ = ''; render();
      }, function () { adding = null; ingQ = ''; render(); }));
      renderIngHits(adding);
      return;
    }

    w.appendChild(h('button', {
      class: 'btn', style: 'margin-bottom:12px',
      onclick: function () {
        adding = { name: '', ingredientId: null, netWeight: null, unit: 'g',
                   sellMode: '定量预包装', price: null, note: '' };
        ingQ = ''; render();
      },
    }, ['＋ 加一条库里没有的']));

    w.appendChild(h('div', { class: 'row' }, [
      h('input', {
        type: 'text', placeholder: '搜商品名或食材……', value: q,
        oninput: function (e) { q = e.target.value.trim(); renderList(); },
      }),
    ]));

    w.appendChild(h('div', { class: 'chips', style: 'margin-bottom:14px' },
      [['all', '全部'], ['unverified', '未核对'], ['mine', '我改过/加的']].map(function (f) {
        return h('button', {
          type: 'button', 'aria-pressed': String(filter === f[0]),
          onclick: function () { filter = f[0]; render(); },
        }, [f[1]]);
      })));

    if (hid) {
      w.appendChild(h('button', {
        class: 'btn ghost', style: 'margin-bottom:12px;padding:7px;font-size:13px',
        onclick: function () {
          if (confirm('把隐藏的 ' + hid + ' 条恢复出来?')) { Store.set('hiddenPackages', []); render(); }
        },
      }, ['恢复 ' + hid + ' 条隐藏的']));
    }

    w.appendChild(h('div', { id: 'pkglist' }));
    el.appendChild(w);
    renderList();
  }

  function renderList() {
    var list = el.querySelector('#pkglist');
    if (!list) return;
    list.innerHTML = '';
    var rows = merged().filter(function (p) {
      if (filter === 'unverified' && p.confidence === 'A') return false;
      if (filter === 'mine' && !p.userEdited) return false;
      if (!q) return true;
      var ing = Catalog.ingredient(p.ingredientId);
      var hay = (p.name || '') + ' ' + p.ingredientId +
                (ing ? ' ' + ing.name + ' ' + (ing.aliases || []).join(' ') : '');
      return hay.toLowerCase().indexOf(q.toLowerCase()) >= 0;
    });

    if (!rows.length) {
      list.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['🔍']),
        h('div', {}, [q ? '没找到「' + q + '」—— 可以用上面的按钮加一条' : '这个筛选下没有条目']),
      ]));
      return;
    }
    rows.slice(0, 60).forEach(function (p) { list.appendChild(card(p)); });
    if (rows.length > 60) {
      list.appendChild(h('div', { class: 'hint', style: 'text-align:center' },
        ['还有 ' + (rows.length - 60) + ' 条,用搜索缩小范围']));
    }
  }

  function mount(node) { el = node; editing = null; adding = null; render(); }

  return { mount: mount, merged: merged };
})();

if (typeof module !== 'undefined') module.exports = PackagesUI;
