// 「库存」页 —— 这是整个应用的护城河页(DESIGN 第一节:库存模块 > 求解器 > 菜谱库)。
//
// 三件事必须做到:
//   1. **一眼看出该先吃什么** —— 按紧迫度排序并着色,不是按入库顺序平铺
//   2. **能记「扔了」** —— 没有这个动作,系统永远不知道你实际浪费了什么,
//      所有「常剩食材」诊断就都是推测。这是唯一必须手动的一步,因为没法自动观测
//   3. **有手动逃生口** —— 零录入是目标不是教条。你在楼下超市顺手买的东西、
//      吃掉一半的东西,得能记上,否则库存和现实脱节一次就再也不准了
//
// 调料柜和冰箱交互不同,因为两种库存性质不同:调料是有/没有,生鲜是还剩多少。

var PantryUI = (function () {

  var grainOpen = null;   // 主食那段展开没有。null = 按「勾过没有」自动决定
  var el, tab = 'fridge', q = '', adding = false, addDraft = null,
      ingQ = '', composing = false;   // composing:中文输入法正在组字,这期间不能重渲染

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      n.appendChild(typeof c === 'string' ? Dom.text(c) : c);
    });
    return n;
  }

  function now() { return new Date().toISOString(); }
  function items() { return Pantry.items(); }
  function saveItems(v) { Store.set('pantryItems', v); }

  // ---------------- 冰箱 ----------------

  function daysLeft(it) {
    if (!it.expiresAt) return null;
    return Math.round((Date.parse(it.expiresAt) - Date.parse(now())) / 864e5);
  }

  function urgencyClass(d) {
    if (d == null) return '';
    if (d < 0) return 'danger';
    if (d <= 2) return 'warn';
    return '';
  }

  /** 记一笔浪费 —— 这是诊断统计唯一的真实数据源 */
  function logWaste(it, grams) {
    var log = Store.get('wasteLog', []) || [];
    log.push({ at: now(), ingredientId: it.ingredientId, grams: grams,
               addedAt: it.addedAt, expiresAt: it.expiresAt });
    Store.set('wasteLog', log);
  }

  function removeItem(id) {
    saveItems(items().filter(function (x) { return x.id !== id; }));
  }

  function setAmount(id, grams) {
    var list = items();
    var it = list.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    if (grams <= 0) { removeItem(id); return; }
    it.amount = grams;
    saveItems(list);
  }

  /**
   * 冰箱里的一样东西。
   *
   * ⚠️ 改版前是**一张 card + 四个整宽按钮**(改数量 / 吃完了 / 扔了 / 记错了)。
   *    十样库存就是四十个按钮,而且四个长得一模一样 —— 一件事上摆四个
   *    同等份量的按钮等于没有主次:每次都得读一遍才知道点哪个。
   *
   *    最常做的是「改数量」(吃了一半、称了一下),所以它成了**整行**;
   *    剩下三个收进「···」。Modal.pick 本来就是干这个的。
   */
  function itemCard(it) {
    var ing = Catalog.ingredient(it.ingredientId);
    var d = daysLeft(it);
    var cls = urgencyClass(d);
    var name = ing ? ing.name : it.ingredientId;

    function askAmount() {
      Modal.ask({
        title: name + ' 还剩多少?',
        hint: '称一下最准;估个数也比不记强。',
        type: 'number', value: Math.round(it.amount), suffix: it.unit || 'g',
        presets: [
          { label: '还剩一半', value: Math.round(it.amount / 2) },
          { label: '剩一点点', value: Math.round(it.amount * 0.2) },
        ],
      }).then(function (v) {
        if (v == null) return;
        var n = parseFloat(v);
        if (!isNaN(n)) { setAmount(it.id, n); render(); }
      });
    }

    // ⚠️ 「扔了」写进 wasteLog,那是诊断统计唯一的真实数据源。
    //    所以必须另给一个「记错了」—— 否则用户拿「扔了」当通用删除键,
    //    系统就会以为他真扔了食物,「什么东西总是剩」的结论跟着变成垃圾。
    function askWaste() {
      Modal.ask({
        title: '扔了多少 ' + name + '?',
        hint: '记下来才能看出什么东西总是剩 —— 这是唯一没法自动观测的一步。',
        type: 'number', value: Math.round(it.amount), suffix: it.unit || 'g',
        ok: '记一笔浪费',
        presets: [
          { label: '全扔了', value: Math.round(it.amount) },
          { label: '扔了一半', value: Math.round(it.amount / 2) },
        ],
      }).then(function (v) {
        if (v == null) return;
        var n = parseFloat(v);
        if (isNaN(n) || n <= 0) return;
        logWaste(it, Math.min(n, it.amount));
        if (n >= it.amount) removeItem(it.id);
        else setAmount(it.id, it.amount - n);
        render();
      });
    }

    var box = h('div', { class: 'list-row', onclick: askAmount });
    box.appendChild(h('div', { class: 'body' }, [
      h('div', { class: 'ttl' }, [
        name,
        h('span', { style: 'font-weight:400;margin-left:8px' },
          [Math.round(it.amount) + (it.unit || 'g')]),
      ]),
      h('div', { class: 'sub2' }, [
        // ⚠️ 兜底不能少:location 缺失时原来直接把 undefined 印在界面上。
        //    老数据、导入进来的数据都可能没这个字段,而「undefined」是
        //    最糟的失败方式 —— 看着像程序坏了,其实只是少一个字段。
        (Dom.label('location', it.location) || '存着') +
        ' · 买于 ' + it.addedAt.slice(5, 10) +
        (it.openedAt ? ' · 已开封' : ''),
      ]),
    ]));
    if (d != null) {
      box.appendChild(h('span', {
        class: 'st',
        style: cls === 'danger' ? 'background:var(--danger-dim);color:var(--danger)'
             : cls === 'warn' ? 'background:var(--warn-dim);color:var(--warn)' : '',
      }, [d < 0 ? '过期 ' + (-d) + ' 天' : d === 0 ? '今天到期' : d + ' 天']));
    }
    box.appendChild(h('span', {
      class: 'act',
      onclick: function (e) {
        e.stopPropagation();           // 别把「打开菜单」变成「改数量」
        Modal.pick({
          title: name + ' ' + Math.round(it.amount) + (it.unit || 'g'),
          options: [
            { value: 'eaten', label: '吃完了', hint: '从冰箱去掉,不算浪费' },
            { value: 'waste', label: '扔了',   hint: '记一笔浪费 —— 统计只认这里的数' },
            { value: 'wrong', label: '记错了', hint: '当没记过,不影响浪费统计',
              danger: true },
          ],
        }).then(function (v) {
          if (v === 'eaten') { removeItem(it.id); render(); }
          else if (v === 'waste') askWaste();
          else if (v === 'wrong') {
            Modal.confirm({
              title: '直接删掉这条?',
              body: '不算浪费、也不算吃掉 —— 就当没记过。浪费统计不会受影响。',
              ok: '删掉', danger: true,
            }).then(function (ok) { if (ok) { removeItem(it.id); render(); } });
          }
        });
      },
    }, ['···']));
    return box;
  }

  function renderFridge(w) {
    var its = items().slice();

    if (adding) { w.appendChild(addForm()); return; }

    w.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-bottom:12px',
      onclick: function () {
        adding = true;
        addDraft = { ingredientId: null, amount: null, location: 'fridge' };
        ingQ = ''; render();
      },
    }, ['＋ 手动记一样(app 之外买的)']));

    if (!its.length) {
      // ⚠️ 空状态原来是**三块**在说同一件事:按钮、🧊「冰箱是空的」、
      //    再加一张解释卡。屏幕上什么都没有的时候,反而堆了三个框 ——
      //    空状态就该是一块:一句「现在是什么情况」+ 一句「所以呢」。
      //
      // ⚠️ 而且那句解释原来被拆成两个 div,第一个以逗号结尾 ——
      //    渲染出来在逗号处硬换行。一句话就该是一个块。
      w.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['🧊']),
        h('div', { style: 'font-weight:600' }, ['冰箱是空的']),
        h('div', { class: 'hint', style: 'max-width:34em;margin:8px auto 0' }, [
          '平时不用管这里 —— 采购清单勾「已买」会自动进来,做完一顿自动扣减。',
        ]),
      ]));
      return;
    }

    // 按紧迫度排序 —— 快烂的置顶。按入库顺序平铺等于让人自己找。
    its.sort(function (a, b) {
      var da = daysLeft(a), db2 = daysLeft(b);
      if (da == null && db2 == null) return 0;
      if (da == null) return 1;
      if (db2 == null) return -1;
      return da - db2;
    });

    var soon = its.filter(function (x) { var d = daysLeft(x); return d != null && d <= 2; });
    var total = its.reduce(function (s, x) { return s + x.amount; }, 0);
    w.appendChild(h('div', { class: soon.length ? 'note warn' : 'note' }, [
      its.length + ' 样 · 共 ' + (total / 1000).toFixed(1) + 'kg' +
      (soon.length ? ' · **' + soon.length + ' 样两天内到期**,下次生成会优先排掉' : ''),
    ]));

    var groups = [
      { key: 'urgent', label: '快到期', test: function (d) { return d != null && d <= 2; } },
      { key: 'soon', label: '一周内', test: function (d) { return d != null && d > 2 && d <= 7; } },
      { key: 'ok', label: '还早', test: function (d) { return d == null || d > 7; } },
    ];
    groups.forEach(function (g) {
      var rows = its.filter(function (x) { return g.test(daysLeft(x)); });
      if (!rows.length) return;
      w.appendChild(h('h2', {}, [g.label + ' · ' + rows.length]));
      var list = h('div', { class: 'list' });
      rows.forEach(function (x) { list.appendChild(itemCard(x)); });
      w.appendChild(list);
    });

    var wl = Store.get('wasteLog', []) || [];
    if (wl.length) {
      var g2 = wl.reduce(function (s, x) { return s + x.grams; }, 0);
      w.appendChild(h('div', { class: 'hint', style: 'text-align:center;margin-top:16px' }, [
        '累计记了 ' + wl.length + ' 笔浪费,共 ' + (g2 / 1000).toFixed(1) + 'kg —— ' +
        '攒够几周就能看出「什么东西总是剩」',
      ]));
    }
  }

  function addForm() {
    var box = h('div', { class: 'card' });
    box.appendChild(h('div', { style: 'font-weight:600;margin-bottom:12px' }, ['手动记一样']));

    box.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['是什么']),
      h('input', {
        type: 'text', placeholder: '搜食材…… 例:鸡蛋 / 上海青', value: ingQ,
        oninput: function (e) { ingQ = e.target.value.trim(); renderHits(); },
      }),
      h('div', { id: 'hits', style: 'margin-top:8px' }),
    ]));
    box.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['多少克']),
      h('input', {
        type: 'number', inputmode: 'decimal', placeholder: '300',
        onchange: function (e) {
          var v = parseFloat(e.target.value);
          addDraft.amount = isNaN(v) ? null : v;
        },
      }),
    ]));
    box.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['放哪儿']),
      h('div', { class: 'seg' }, [['fridge', '冷藏'], ['freezer', '冷冻'], ['pantry', '常温']]
        .map(function (o) {
          return h('button', {
            type: 'button', 'aria-pressed': String(addDraft.location === o[0]),
            onclick: function () { addDraft.location = o[0]; render(); },
          }, [o[1]]);
        })),
    ]));
    // ⚠️ 校验不弹窗。「先选是什么」这种话弹出来打断一下、还得点确定,
    //    远不如直接在按钮下面写一行 —— 错在哪儿眼睛就在哪儿。
    var err = h('div', { class: 'note warn', style: 'display:none;margin-bottom:12px' });
    box.appendChild(err);
    function fail(msg) { err.textContent = msg; err.style.display = 'block'; }

    box.appendChild(h('button', {
      class: 'btn',
      onclick: function () {
        if (!addDraft.ingredientId) { fail('还没选是什么 —— 上面搜一下'); return; }
        if (!addDraft.amount) { fail('还差克数 —— 估个数也行'); return; }
        Pantry.addFromPackage({ id: addDraft.ingredientId, ingredientId: addDraft.ingredientId,
                                netWeight: addDraft.amount, unit: 'g' },
                              now(), addDraft.location);
        var list = items();
        list[list.length - 1].source = 'manual';
        saveItems(list);
        adding = false; render();
      },
    }, ['记下']));
    box.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:8px',
      onclick: function () { adding = false; render(); },
    }, ['取消']));
    return box;
  }

  function renderHits() {
    var host = el.querySelector('#hits');
    if (!host) return;
    host.innerHTML = '';
    if (!ingQ) return;

    // 用 Search 而不是自己 filter + slice(0,8) ——
    // 那样是按字典文件的书写顺序取前 8 个,搜「鸡」时鸡蛋排第 9 被切掉了。
    var r = Search.find(ingQ, Search.FRESH, 12);

    if (!r.total) {
      host.appendChild(h('div', { class: 'hint' }, ['冰箱这边没有「' + ingQ + '」']));
      var other = Search.find(ingQ, Search.STAPLE, 4);
      if (other.total) {
        host.appendChild(h('div', { class: 'note' }, [
          '不过调料柜里有 ' + other.total + ' 个匹配(' +
          other.hits.map(function (i) { return i.name; }).join(' · ') +
          ')—— 这一栏只管生鲜,调料在「调料柜」那边。',
        ]));
      }
      return;
    }

    host.appendChild(h('div', { class: 'chips' }, r.hits.map(function (i) {
      // 命中的是别名就标出来,否则「搜豆出来西洋菜」看着像坏了
      var al = Search.matchedAlias(i, ingQ);
      return h('button', {
        type: 'button', 'aria-pressed': String(addDraft.ingredientId === i.id),
        onclick: function () { addDraft.ingredientId = i.id; render(); },
      }, [i.name + (al ? '(' + al + ')' : '')]);
    })));
    if (r.total > r.hits.length) {
      host.appendChild(h('div', { class: 'hint', style: 'margin-top:4px' },
        ['还有 ' + (r.total - r.hits.length) + ' 个,搜得再具体点']));
    }
  }

  // ---------------- 调料柜 ----------------

  function fmtDate(iso) {
    return iso ? iso.slice(5, 7) + '/' + iso.slice(8, 10) : null;
  }

  /** 一行小字讲清楚:什么时候买的、开没开封、还能放多久
   *
   * ⚠️ **只有「开封后会变质」的东西才提开封。**
   *    改版前每一行都写「未开封」—— 包括食盐和白砂糖。可这两样
   *    `openedShelfLifeDays` 是空的(它们根本不会坏),所以**不会**出现
   *    「开封了」按钮 —— 于是那行字说了一个你**永远改不了**的状态,
   *    看起来像按钮坏了或者漏了,其实是故意不问。
   *
   *    判据和按钮用的是同一个:worthTrackingOpened(≤200 天才值得记)。
   *    盐 · 糖 → 没有开封保质期      蜂蜜 · 料酒 → 360 天,超过门槛
   *    生抽 · 老抽 · 白胡椒粉 → 180 天    食用油 → 90 天
   *    两边必须用同一个判据,不然又是「按钮和文字各说各的」。 */
  function ageText(entry, ing) {
    var n = now();
    if (entry.openedAt) {
      var d = Pantry.openedDaysLeft(entry, n);
      if (d == null) return { text: fmtDate(entry.openedAt) + ' 开封', level: 'ok' };
      return {
        text: fmtDate(entry.openedAt) + ' 开封 · ' +
              (d < 0 ? '超期 ' + (-d) + ' 天' : '还能放 ' + d + ' 天'),
        level: d < 0 ? 'bad' : (d < 14 ? 'warn' : 'ok'),
      };
    }
    if (entry.addedAt) {
      var u = Pantry.unopenedDaysLeft(entry, n);
      var since = Math.round((Date.parse(n) - Date.parse(entry.addedAt)) / 864e5);
      var track = Pantry.worthTrackingOpened(ing);
      return {
        text: fmtDate(entry.addedAt) + ' 买 · ' +
              (since <= 0 ? '今天' : since + ' 天前') +
              (track ? ' · 未开封' : '') +
              (u != null && u < 90 ? ' · 保质期剩 ' + u + ' 天' : ''),
        level: (u != null && u < 0) ? 'bad' : (u != null && u < 30 ? 'warn' : 'ok'),
      };
    }
    return { text: '没记买入时间 —— 点 ··· 补上', level: 'dim' };
  }

  /** 密集单行。「我有什么、什么时候买的」要一眼扫完,一样一张卡片是扫不动的。 */
  function ownedRow(ing, catLabel) {
    var entry = Pantry.stapleEntry(ing.id);
    if (!entry) return h('span', {});
    var track = Pantry.worthTrackingOpened(ing);
    var a = ageText(entry, ing);
    var color = { bad: 'var(--danger)', warn: 'var(--warn)', dim: 'var(--text-dim)' }[a.level]
                || 'var(--text-dim)';

    var row = h('div', {
      style: 'display:flex;gap:8px;align-items:center;padding:8px 0;' +
             'border-bottom:1px solid var(--border)',
    });
    row.appendChild(h('div', { style: 'flex:1;min-width:0' }, [
      h('div', {}, [
        ing.name,
        catLabel ? h('span', { class: 'hint', style: 'margin-left:8px' }, [catLabel])
                 : h('span', {}),
      ]),
      h('div', { style: 'font-size:12px;color:' + color }, [a.text]),
    ]));
    // ⚠️ 行内次操作用 .act,不是 .btn 加一串覆盖。
    //    .btn 是主按钮:display:flex 的块级元素、min-height 48。
    //    拿它当小按钮使,得写 width:auto + padding + font-size + flex 四条覆盖,
    //    而 width:auto **盖不住块级换行** —— 菜谱页那两个按钮就是这么
    //    上下堆起来的,还各顶着 48px 高配 13px 的字。
    if (track && !entry.openedAt) {
      row.appendChild(h('button', {
        class: 'act',
        onclick: function () { Pantry.setOpened(ing.id, now()); render(); },
      }, ['开封了']));
    }
    row.appendChild(h('button', {
      class: 'act',
      onclick: function () { editStaple(ing, entry); },
    }, ['···']));
    return row;
  }

  /** ⚠️ 以前这里是一个 prompt,内容是「1 = 改买入日期 / 2 = ... 输入数字:」——
   *    让人在弹窗里打数字选菜单项。选择题就该给按钮。 */
  function editStaple(ing, entry) {
    var custom = !!(ing && ing.custom);
    Modal.pick({
      title: ing.name,
      hint: custom ? '自己加的条目 —— 库里没有保质期数据,只记有没有和时间。' : null,
      options: [
        { key: 'bought', label: '改买入时间',
          hint: entry.addedAt ? '现在记的是 ' + entry.addedAt.slice(0, 10) : '现在没记' },
        { key: 'opened', label: entry.openedAt ? '改开封时间' : '标记为已开封',
          hint: entry.openedAt ? '现在记的是 ' + entry.openedAt.slice(0, 10)
                               : (ing.openedShelfLifeDays
                                  ? '开封后只能放 ' + ing.openedShelfLifeDays + ' 天'
                                  : null) },
        { key: 'used', label: '用完了', hint: '正常吃完,从柜子里去掉' },
        { key: 'wrong', label: '记错了,其实没有', hint: '当没记过', danger: true },
      ],
    }).then(function (pick) {
      if (!pick) return;

      if (pick === 'bought') {
        return Modal.ask({
          title: '什么时候买的?',
          hint: '不记得就留空 —— 空着比填个假日期强,保质期提醒会跟着关掉。',
          type: 'date', value: entry.addedAt ? entry.addedAt.slice(0, 10) : '',
          allowEmpty: true, emptyLabel: '不记得了',
          presets: [{ label: '今天', value: new Date().toISOString().slice(0, 10) }],
        }).then(function (d) {
          if (d == null) return;
          Pantry.setBought(ing.id, d ? new Date(d).toISOString() : null);
          render();
        });
      }

      if (pick === 'opened') {
        return Modal.ask({
          title: '什么时候开封的?',
          hint: ing.openedShelfLifeDays
            ? '这样能算出还能放多久(开封后 ' + ing.openedShelfLifeDays + ' 天)。'
            : '库里没有这样东西的开封保质期,填了也算不出剩余天数。',
          type: 'date',
          value: entry.openedAt ? entry.openedAt.slice(0, 10)
                                : new Date().toISOString().slice(0, 10),
          allowEmpty: true, emptyLabel: '其实还没开封',
          presets: [{ label: '今天', value: new Date().toISOString().slice(0, 10) }],
        }).then(function (d) {
          if (d == null) return;
          Pantry.setOpened(ing.id, d ? new Date(d).toISOString() : null);
          render();
        });
      }

      // 「用完了」和「记错了」都是从柜子里去掉,但分开问是有意义的:
      // 以后统计「多久用完一瓶」时,得分得清「用完了」和「压根没有过」。
      Pantry.toggleStaple(ing.id);
      render();
    });
  }

  /** 全库浏览/搜索时用的勾选行。
   *  @param unknownDate 勾上时不盖今天的时间戳(第一次开柜子清点用)
   *
   *  ⚠️ **整行都要能点**。第一版只有那个 18px 的 ☐ 是按钮,
   *     手指去点「食盐」这三个字是没反应的 —— 而那才是人自然会点的地方。 */
  function pickRow(ing, unknownDate) {
    var has = Pantry.hasStaple(ing.id);
    var hit = function () {
      if (unknownDate) Pantry.toggleStaple(ing.id, null);
      else Pantry.toggleStaple(ing.id);
      render();
    };
    // ⚠️ 用 .list-row + .ck,不自己画 ——
    //    原来这行自带 `border-bottom` 和 ☐ / ☑ 两个字符:
    //    放进 .list 里就是**双线**(容器已经给了分隔线),
    //    而且 ☐ 是个**字形**,行高和字号一变就和右边的文字对不齐。
    //    .ck 是画出来的方框,垂直居中由 flex 保证。
    var row = h('div', { class: 'list-row' + (has ? ' on' : ''), onclick: hit });
    row.appendChild(h('span', { class: 'ck' }, ['✓']));
    var al = q ? Search.matchedAlias(ing, q) : null;
    row.appendChild(h('div', { class: 'body' }, [
      h('div', { class: 'ttl' }, [ing.name + (al ? '(' + al + ')' : '')]),
      h('div', { class: 'sub2' }, [
        (ing.packaging || '规格未填') + (ing.inevitableSurplus ? ' · 单人多半吃不完' : ''),
      ]),
    ]));
    return row;
  }

  function renderStaples(w) {
    Pantry.ensureInit();
    var mine = Pantry.staples() || [];

    // ⚠️ 这一页只回答一个问题:**我有什么、还能放多久**。
    //
    //    早先还挂了「没有的 370 种」按类别折叠 —— 那是 15 个折叠块的墙。
    //    但你根本不需要浏览没有的调料:加一样只发生在「刚买了」或
    //    「生成计划时 app 问你」这两种时候,两种都不用翻列表。
    //    所以「没有的」退化成一个搜索框。
    //
    //    11 样东西也不该切成 6 个类别小标题 —— 类别做成行内小字就够了。

    var alerts = Pantry.stapleAlerts(now());
    alerts.forEach(function (a) {
      w.appendChild(h('div', { class: 'note warn' }, [
        a.name + ' —— ' + (a.expired ? '开封超期 ' + (-a.daysLeft) + ' 天' : '还有 ' + a.daysLeft + ' 天') +
        (a.usedInDishes ? ',库里 ' + a.usedInDishes + ' 道菜用它,下次可以优先排' : ''),
      ]));
    });

    // 第一次开柜子:问一遍最常用的这几样有没有。**问,不是替他勾上。**
    //
    // ⚠️ 这里勾上不盖今天的时间戳(toggleStaple 传 null)——
    //    「我有盐」不等于「我今天买了盐」,那瓶盐可能放了半年。
    if (!Pantry.confirmed() && !q) {
      w.appendChild(h('div', { class: 'note' }, [
        '先清点一下 —— 这几样最常用。**没勾的会当成你没有**,以后出现在采购清单上,' +
        '所以别勾你其实没有的。',
      ]));
      var c0 = h('div', { class: 'card', style: 'padding:4px 16px' });
      Pantry.STARTER.forEach(function (id) {
        var ing = INGREDIENTS.filter(function (x) { return x.id === id; })[0];
        if (ing) c0.appendChild(pickRow(ing, true));
      });
      w.appendChild(c0);

      // 米面杂粮 —— **这一段决定了你的计划里主食长什么样。**
      //
      // ⚠️ 以前清点清单只有调料,米面不在里面,于是求解器只能默认白米:
      //    80% 的顿配白米饭、34/100 轮四顿全白米。
      //    勾几样杂粮,它就在这几样之间轮换;不勾就还是白米。
      w.appendChild(h('div', { class: 'note', style: 'margin-top:16px' }, [
        '**主食**。勾几样,计划里就会换着来 —— 只勾白米就顿顿白米饭。',
      ]));
      var c1 = h('div', { class: 'card', style: 'padding:4px 16px' });
      Pantry.STARTER_GRAINS.forEach(function (id) {
        var ing = INGREDIENTS.filter(function (x) { return x.id === id; })[0];
        if (ing) c1.appendChild(pickRow(ing, true));
      });
      w.appendChild(c1);
      w.appendChild(h('button', {
        class: 'btn', style: 'margin-top:12px',
        onclick: function () { Pantry.setConfirmed(); render(); },
      }, [mine.length ? '就这 ' + mine.length + ' 样' : '一样都没有']));
      w.appendChild(h('div', { class: 'hint', style: 'text-align:center;margin-top:8px' }, [
        '之后随时能改。别的调料不用在这儿备齐 —— 生成计划时缺哪样会直接问你。',
      ]));
      return;
    }

    // ---- 主食:**常驻**,不是只在第一次清点时出现 ----
    //
    // ⚠️ 这一段原来只画在「第一次开柜子」那一屏里。可那屏只在
    //    `!Pantry.confirmed()` 时出现 —— **已经点过「就这几样」的人
    //    再也看不到它**,于是主食永远是白米,而且不知道为什么。
    //    (我加主食轮换的时候只想着新用户,忘了自己已经确认过柜子了。)
    //
    //    搜索框虽然也能加,但它写的是「买了新调料?」—— 没人会想到
    //    去那儿找糙米。**功能藏在一个只出现一次的地方,等于没有。**
    if (!q) {
      var owned = Pantry.STARTER_GRAINS.filter(function (id) { return Pantry.hasStaple(id); });
      var ownedNames = owned.map(function (id) {
        var i = Catalog.ingredient(id); return i ? i.name : id;
      });
      // ⚠️ 10 样常驻太占地方,而这东西**设一次基本不动**。
      //    默认:还没勾过 → 展开(不然你根本不知道有这回事);
      //          勾过了   → 收起,标题右边直接列出勾了哪几样。
      //    收起的那行本身就把答案说完了,不用点开确认。
      var gOpen = grainOpen === null ? owned.length === 0 : grainOpen;
      w.appendChild(h('div', {
        class: 'list-row' + (gOpen ? ' sticky' : ''),
        style: 'border:1px solid var(--border);border-radius:var(--r-md);' +
               'margin:16px 0 8px;background:var(--surface)',
        onclick: function () { grainOpen = !gOpen; render(); },
      }, [
        h('div', { class: 'body' }, [
          h('div', { class: 'ttl' }, ['主食']),
          h('div', { class: 'sub2' }, [
            !owned.length ? '一样都没勾 —— 排菜时默认配白米饭'
              : ownedNames.join(' · ') +
                (owned.length > 1 ? '(换着来)' : '(顿顿吃它)'),
          ]),
        ]),
        h('span', { class: 'dim' }, [gOpen ? '▴' : '▸']),
      ]));
      if (gOpen) {
        var gl = h('div', { class: 'list', style: 'margin-bottom:16px' });
        Pantry.STARTER_GRAINS.forEach(function (id) {
          var ing = INGREDIENTS.filter(function (x) { return x.id === id; })[0];
          if (ing) gl.appendChild(pickRow(ing, true));
        });
        w.appendChild(gl);
      }
    }

    w.appendChild(h('div', { class: 'row' }, [
      h('input', {
        id: 'staple-q',                       // 稳定 id —— keepFocus 靠它把焦点找回来
        type: 'text', placeholder: '买了新调料?搜一下加进来', value: q,
        // ⚠️ 中文输入法组字期间不能重渲染 —— 输入框一被重建,组字会话就没了,
        //    表现是「英文能打,中文一个字都打不进去」。keepFocus 救不了这个。
        oncompositionstart: function () { composing = true; },
        oncompositionend: function (e) {
          composing = false; q = e.target.value.trim(); render();
        },
        oninput: function (e) {
          if (composing) return;
          q = e.target.value.trim(); render();
        },
      }),
    ]));

    if (q) {
      var r = Search.find(q, Search.STAPLE, 20);
      var c = h('div', { class: 'card', style: 'padding:4px 16px' });
      if (!r.total) {
        c.appendChild(h('div', { class: 'hint', style: 'padding:12px 0' },
          ['调料柜里没有「' + q + '」']));
        var other = Search.find(q, Search.FRESH, 4);
        if (other.total) {
          c.appendChild(h('div', { class: 'hint', style: 'padding-bottom:12px' }, [
            '冰箱那边有:' + other.hits.map(function (i) { return i.name; }).join(' · '),
          ]));
        }
      } else {
        r.hits.forEach(function (i) { c.appendChild(pickRow(i)); });
      }
      w.appendChild(c);
      if (r.total > r.hits.length) {
        w.appendChild(h('div', { class: 'hint', style: 'text-align:center' },
          ['还有 ' + (r.total - r.hits.length) + ' 个,搜具体点']));
      }

      // 字典 628 条不可能全 —— 你家那瓶得能记上,哪怕库里没有。
      // 自定义条目没有保质期、也接不上菜谱,如实标出来,不假装它和别的一样。
      if (!Pantry.hasStaple('custom:' + q)) {
        w.appendChild(h('button', {
          class: 'btn ghost', style: 'margin-top:12px',
          onclick: function () {
            Pantry.addCustomStaple(q);
            q = ''; render();
          },
        }, ['＋ 库里没有,按「' + q + '」记下']));
        w.appendChild(h('div', { class: 'hint', style: 'text-align:center;margin-top:8px' }, [
          '自己加的条目只记「有/没有」和买入时间 —— 保质期和菜谱关联都接不上',
        ]));
      }
      return;
    }

    if (!mine.length) {
      w.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['🧂']),
        h('div', {}, ['柜子是空的 —— 上面搜一下加进来']),
      ]));
      return;
    }

    // 一个平铺列表,按类别排序但不切标题。
    // 走 Pantry.resolve 而不是直接查字典 —— 否则自己加的条目会被静默丢掉。
    var list = mine.map(function (e) { return Pantry.resolve(e); }).filter(Boolean);
    list.sort(function (a, b) {
      if (a.category !== b.category) return (a.category || '').localeCompare(b.category || '', 'zh');
      return a.name.localeCompare(b.name, 'zh');
    });

    w.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
      mine.length + ' 样。缺哪样会在生成计划时直接问你,不用先在这儿备齐。',
    ]));

    var card = h('div', { class: 'card', style: 'padding:4px 16px' });
    var lastCat = null;
    list.forEach(function (i) {
      card.appendChild(ownedRow(i, i.category !== lastCat ? i.category : null));
      lastCat = i.category;
    });
    w.appendChild(card);

    // 建议放最后、压成一行 —— 这是「顺便提一句」,不是页面主体
    var sug = Pantry.suggestUnlocks(3);
    if (sug.length) {
      w.appendChild(h('div', { class: 'hint', style: 'margin-top:16px' }, [
        '还没有的里面,加这几样能多做最多菜:',
      ]));
      w.appendChild(h('div', { class: 'chips' }, sug.map(function (s2) {
        return h('button', {
          type: 'button',
          onclick: function () { Pantry.toggleStaple(s2.id); render(); },
        }, ['+ ' + s2.name + ' ' + s2.dishes + '道']);
      })));
    }
  }

  // ---------------- 页面 ----------------

  /** ⚠️ render() 把整棵子树重建,输入框跟着被销毁 —— 焦点和光标位置一起没了。
   *    表现是**打一个字就得重新点一下输入框**,搜索框基本没法用。
   *    给输入框一个稳定 id,重建后按 id 找回来,并把光标放回原处。
   *    (settings 那边是另一种解法:只重渲染结果区、不动输入框。两种都行,
   *     这里页面结构随 q 变化太大,重建 + 找回焦点更简单。) */
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
    w.appendChild(h('h1', {}, ['库存']));

    w.appendChild(h('div', { class: 'seg', style: 'margin-bottom:16px' },
      [['fridge', '冰箱 ' + items().length], ['staples', '调料柜']].map(function (t) {
        return h('button', {
          type: 'button', 'aria-pressed': String(tab === t[0]),
          onclick: function () { tab = t[0]; q = ''; adding = false; render(); },
        }, [t[1]]);
      })));

    if (tab === 'staples') renderStaples(w); else renderFridge(w);
    el.appendChild(w);
    if (adding) renderHits();
  }

  function mount(node) { el = node; adding = false; render(); }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = PantryUI;
