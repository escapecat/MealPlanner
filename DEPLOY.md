# 放到手机上

两条路。**先走第一条,今晚就能用。**

---

## 1. 局域网(不用账号,现在就能用)

```
python tools/serve.py
```

它会打印一个 `http://192.168.x.x:8000/`,手机连同一个 WiFi 打开就行。

- iPhone:Safari 打开 → 分享 → **添加到主屏幕**
- 安卓:浏览器打开 → 菜单 → **添加到主屏幕**

加完之后有图标、全屏、没有地址栏,和 app 差不多。

**限制:电脑关了就打不开。** 而且局域网是 http,装不了 Service Worker
(浏览器只允许在 https 或 localhost 上装),所以**离线用不了** —— 出门在超市里没戏。

---

## 2. GitHub Pages(随时能用 + 离线)

需要你做四步。这个仓库现在**没有任何 remote**,所以第一步是建仓库 ——
那是对外的动作,我不会替你做。

1. 在 GitHub 上新建一个仓库(**private 也行**,Pages 对 private 仓库在
   免费版下不可用,所以要用 Pages 就得 public;不想公开的话看下面「不想公开」)
2. ```
   git remote add origin git@github.com:<你>/<仓库名>.git
   git push -u origin master
   ```
3. 仓库 → Settings → Pages → Source 选 `Deploy from a branch`,
   分支 `master`,目录 `/ (root)`
4. 等一两分钟,打开 `https://<你>.github.io/<仓库名>/`

根目录那个 `index.html` 会自动转到 `app/`(Pages 只能从 `/` 或 `/docs` 发布,
而代码在 `app/` 里)。

**这条路才有离线**:https 下 Service Worker 会装上,第一次打开之后
把 1.4 MB 的菜谱库和全部代码缓存下来,**超市地下一层没信号也照样打得开采购清单**。
见 `app/sw.js`。

### 不想公开代码

- **Cloudflare Pages / Vercel**:都能直连 private 仓库,免费,也是 https。
  配置一样简单(构建命令留空,输出目录填 `.`)。
- 或者仓库放 gitee,用 gitee Pages。

---

## 关于数据

数据存在**浏览器本地**(localStorage),不上传任何地方 —— 这个 app 零网络请求。

所以:

- 局域网版和 Pages 版是**两份独立的数据**(域名不同),互相看不见
- 换手机、清缓存、换浏览器都会丢

要搬数据走「我的 → 导出备份」,到新的地方「导入备份」。
**大改之前先导一份**,这是唯一的兜底。

---

## 改了代码之后

```
sh tools/check.sh          # 必须全绿
git add -A && git push     # Pages 一两分钟后自动更新
```

⚠️ Service Worker 的更新策略是「**页面先走网络,其余先给缓存、后台更新**」——
所以代码改动**要打开两次才生效**:第一次悄悄下载,第二次才用上。
这是故意的,理由见 `app/sw.js` 开头。手机上要立刻看到新版就手动刷新两下。
