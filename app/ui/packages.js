// 包装规格:默认值 + 用户就地编辑
//
// 为什么这一页优先级这么高:全库包装规格 99.3% 未经原文核实(A 级只有 1 条)。
// 求解器的核心是算「买 300g 用 180g,剩 120g 下顿吃掉」—— 输入是估的,
// 算出来的「零浪费」就是假的。
//
// 关键设计:**生成值和用户值分开存**。
//   PACKAGES(app/data/packages.js)是默认值,由 markdown 重新生成时会被覆盖;
//   用户改的存在 Store 的 packageOverrides 里,永远不被覆盖。
// 这样数据层可以继续演进,而用户在盒马站着改的那几个数不会丢。

var PackagesUI = (function () {

  var el, q = '', onlyUnverified = false;

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'html') n.innerHTML = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function overrides() { return Store.get('packageOverrides', {}) || {}; }

  /** 默认值叠加用户修改 —— 这是全应用读包装规格的唯一入口 */
  function merged() {
    var ov = overrides();
    return PACKAGES.map(function (p) {
      var o = ov[p.id];
      return o ? Object.assign({}, p, o, { userEdited: true }) : p;
    });
  }

  function save(id, patch) {
    var ov = overrides();
    ov[id] = Object.assign({}, ov[id] || {}, patch, {
      confidence: 'A',                       // 用户亲眼核对过 = 最高可信度
      editedAt: new Date().toISOString(),
    });
    Store.set('packageOverrides', ov);
  }

  function reset(id) {
    var ov = overrides();
    delete ov[id];
    Store.set('packageOverrides', ov);
  }

  function confBadge(c) {
    var label = { A: 'A 已核对', B: 'B 较可靠', C: 'C 估计值' }[c] || 'C 估计值';
    return h('span', { class: 'conf conf-' + (c || 'C') }, [label]);
  }

  function card(p) {
    var ing = Catalog.ingredient(p.ingredientId);
    var box = h('div', { class: 'card' });

    box.appendChild(h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
      h('strong', {}, [p.name || (ing ? ing.name : p.ingredientId)]),
      confBadge(p.confidence),
      p.userEdited ? h('span', { class: 'conf conf-A' }, ['你改过']) : h('span', {}),
    ]));
    box.appendChild(h('div', { class: 'hint' }, [
      (ing ? ing.name + ' · ' : '') + p.ingredientId +
      (p.sellMode ? ' · ' + p.sellMode : '') + (p.vendor ? ' · ' + p.vendor : ''),
    ]));

    var grid = h('div', { style: 'display:flex;gap:10px;margin-top:10px' });

    grid.appendChild(h('div', { style: 'flex:1' }, [
      h('label', { class: 'lab' }, ['净含量(' + (p.unit || 'g') + ')']),
      h('input', {
        type: 'number', inputmode: 'decimal',
        value: p.netWeight == null ? '' : String(p.netWeight),
        onchange: function (e) {
          var v = parseFloat(e.target.value);
          if (!isNaN(v) && v > 0) { save(p.id, { netWeight: v }); render(); }
        },
      }),
    ]));

    grid.appendChild(h('div', { style: 'flex:1' }, [
      h('label', { class: 'lab' }, ['价格(元)']),
      h('input', {
        type: 'number', inputmode: 'decimal', placeholder: '没填过',
        value: p.price == null ? '' : String(p.price),
        onchange: function (e) {
          var v = parseFloat(e.target.value);
          save(p.id, { price: isNaN(v) ? null : v });
          render();
        },
      }),
    ]));
    box.appendChild(grid);

    if (p.note) box.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' }, [p.note]));

    if (p.userEdited) {
      box.appendChild(h('button', {
        class: 'btn ghost', style: 'margin-top:10px;padding:7px;font-size:13px',
        onclick: function () { reset(p.id); render(); },
      }, ['恢复默认值']));
    }
    return box;
  }

  function render() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });
    var all = merged();
    var edited = all.filter(function (p) { return p.userEdited; }).length;
    var verified = all.filter(function (p) { return p.confidence === 'A'; }).length;

    w.appendChild(h('h1', {}, ['包装规格']));
    w.appendChild(h('p', { class: 'sub' }, [
      '这些是默认值,大部分没核实过。你在超市看到实际规格,顺手改一下 —— ' +
      '求解器算「剩多少」全靠它准。',
    ]));

    w.appendChild(h('div', { class: verified < all.length * 0.1 ? 'note warn' : 'note' }, [
      '已核对 ' + verified + ' / ' + all.length + ' 条' +
      (edited ? '(你改过 ' + edited + ' 条)' : '') +
      '。没核对的按估计值算,采购量可能偏差。',
    ]));

    w.appendChild(h('div', { class: 'row', style: 'margin-top:14px' }, [
      h('input', {
        type: 'text', placeholder: '搜商品名或食材 id……', value: q,
        oninput: function (e) { q = e.target.value.trim(); renderList(); },
      }),
    ]));

    w.appendChild(h('div', { class: 'chips', style: 'margin-bottom:14px' }, [
      h('button', {
        type: 'button', 'aria-pressed': String(onlyUnverified),
        onclick: function () { onlyUnverified = !onlyUnverified; render(); },
      }, ['只看未核对']),
    ]));

    w.appendChild(h('div', { id: 'pkglist' }));
    el.appendChild(w);
    renderList();
  }

  function renderList() {
    var list = el.querySelector('#pkglist');
    if (!list) return;
    list.innerHTML = '';
    var rows = merged().filter(function (p) {
      if (onlyUnverified && p.confidence === 'A') return false;
      if (!q) return true;
      var ing = Catalog.ingredient(p.ingredientId);
      var hay = (p.name || '') + ' ' + p.ingredientId + ' ' + (ing ? ing.name + ' ' + (ing.aliases || []).join(' ') : '');
      return hay.toLowerCase().indexOf(q.toLowerCase()) >= 0;
    });

    if (!rows.length) {
      list.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['🔍']),
        h('div', {}, [q ? '没找到「' + q + '」' : '全部已核对']),
      ]));
      return;
    }
    rows.slice(0, 60).forEach(function (p) { list.appendChild(card(p)); });
    if (rows.length > 60) {
      list.appendChild(h('div', { class: 'hint', style: 'text-align:center' },
        ['还有 ' + (rows.length - 60) + ' 条,用搜索缩小范围']));
    }
  }

  function mount(node) { el = node; render(); }

  // 供求解器使用:读的永远是叠加后的值
  return { mount: mount, merged: merged };
})();

if (typeof module !== 'undefined') module.exports = PackagesUI;
