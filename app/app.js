// 装配层:决定显示哪一页,绑定底部 tab。
// 业务逻辑一律不在这里 —— 这一层只负责「谁来渲染」。

(function () {
  var root = document.getElementById('app');

  var TABS = [
    { id: 'plan',    icon: '🍚', label: '记录' },
    { id: 'pantry',  icon: '🧊', label: '库存' },
    { id: 'pkg',     icon: '📦', label: '规格' },
    { id: 'me',      icon: '⚙️', label: '我的' },
  ];

  var current = 'plan';

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

  function needsOnboarding() {
    var p = Store.get('profile');
    return !p || !p.age || !p.heightCm;
  }

  /** 空状态写「下一步做什么」,不是只写「暂无数据」 */
  function placeholder(title, lines, cta) {
    var w = h('div', { class: 'wrap' }, [
      h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['🥬']),
        h('div', { style: 'font-weight:600;margin-bottom:8px' }, [title]),
      ]),
    ]);
    var c = h('div', { class: 'card' });
    lines.forEach(function (l) { c.appendChild(h('div', { class: 'hint' }, [l])); });
    w.appendChild(c);
    if (cta) {
      w.appendChild(h('button', { class: 'btn ghost', onclick: cta.onclick }, [cta.label]));
    }
    return w;
  }

  function renderTabbar() {
    return h('nav', { class: 'tabbar' }, TABS.map(function (t) {
      return h('button', {
        type: 'button',
        'aria-current': current === t.id ? 'page' : null,
        onclick: function () { current = t.id; render(); },
      }, [
        h('span', { class: 'ic' }, [t.icon]),
        h('span', {}, [t.label]),
      ]);
    }));
  }

  function render() {
    root.innerHTML = '';

    if (needsOnboarding()) {
      Onboarding.onDone = function () { current = 'plan'; render(); };
      Onboarding.mount(root);
      return;
    }

    var page = h('div');
    if (current === 'pkg') {
      PackagesUI.mount(page);
    } else if (current === 'me') {
      SettingsUI.mount(page);
    } else if (current === 'pantry') {
      page.appendChild(placeholder('库存还是空的', [
        '库存不用手动录 —— 采购清单上勾「已买」就会自动按包装规格入库,',
        '某顿点「完成」就自动按用量扣减。',
        '所以先去「本周」新建一次做饭记录。',
      ], { label: '去记一次', onclick: function () { current = 'plan'; render(); } }));
    } else {
      RoundsUI.mount(page, { onOpenPkg: function () { current = 'pkg'; render(); } });
    }
    root.appendChild(page);
    root.appendChild(renderTabbar());
  }

  render();
})();
