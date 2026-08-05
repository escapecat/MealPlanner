// 文案里的 **重点** 要真的变粗。
//
// ⚠️ 这是个一直存在、而且用户一直看得见的 bug:
//    每个 UI 模块的 h() 都是 `document.createTextNode(c)`,
//    于是文案里写的 `**两天内到期**` 在页面上就是字面的星号。
//    五个文件三十多处,全都在最该强调的那句话上。
//
// 不做完整 markdown —— 只认 **粗体** 一种,因为文案里只用到这一种。
// 认得越多,越容易在食材名(比如「5*5cm」)上误伤。

var Dom = (function () {

  /** 把一段文字变成节点。含 **x** 就拆成若干段,其余原样。 */
  function text(s) {
    if (typeof s !== 'string' || s.indexOf('**') < 0) {
      return document.createTextNode(s == null ? '' : String(s));
    }
    var frag = document.createDocumentFragment();
    // 成对匹配;落单的星号原样留着,不吞字
    var parts = s.split(/\*\*([^*]+)\*\*/g);
    parts.forEach(function (chunk, i) {
      if (chunk === '') return;
      if (i % 2 === 1) {
        var b = document.createElement('strong');
        b.appendChild(document.createTextNode(chunk));
        frag.appendChild(b);
      } else {
        frag.appendChild(document.createTextNode(chunk));
      }
    });
    return frag;
  }

  return { text: text };
})();

if (typeof module !== 'undefined') module.exports = Dom;
