// 开机首件确认 —— 页面操作
// 规则口径以常量形式从规则文件注入，避免与判定逻辑脱节。
// 只负责首件确认面板的结构、样式和前端交互；确认规则见
// ./firstPieceRules.js，记录保存见 ./firstPieceRecords.js。

export function firstPieceStyle() {
  return `
  .fp-wrap { padding:0 28px 28px; }
  .fp-banner { border:1px solid var(--line); border-left:5px solid #b07b2a; background:#fdf7ea; border-radius:8px; padding:12px 16px; margin-bottom:16px; font-size:14px; }
  .fp-banner.none { border-left-color:#526f43; background:#f1f6ec; }
  .fp-error { color:#a3372c; font-size:13px; min-height:18px; margin-top:8px; }
  .fp-layout { display:grid; grid-template-columns:390px 1fr; gap:22px; align-items:start; }
  .fp-create h3, .fp-orders h3, .fp-correct h3 { margin:0 0 10px; font-size:16px; }
  .fp-order { border:1px solid var(--line); border-radius:8px; padding:14px; margin-bottom:12px; background:#fbfcf9; display:grid; gap:8px; }
  .fp-order-head { display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; }
  .fp-order-head b { font-size:15px; }
  .fp-status { border-radius:999px; padding:3px 10px; font-size:12px; border:1px solid var(--line); }
  .fp-status.pending, .fp-status.regrind { background:#fdf1dc; border-color:#dcb678; color:#8a5d17; }
  .fp-status.released { background:#eef5e6; border-color:#9ab483; color:#3f5b30; }
  .fp-status.void { background:#f2f1ee; border-color:#c4c2bb; color:#6d6a63; }
  .fp-pieces { border-top:1px dashed var(--line); padding-top:8px; display:grid; gap:6px; }
  .fp-piece { font-size:13px; }
  .fp-piece .ok { color:#3f5b30; font-weight:700; } .fp-piece .bad { color:#a3372c; font-weight:700; }
  .fp-events { font-size:12px; color:var(--muted); border-top:1px dashed var(--line); padding-top:8px; display:grid; gap:3px; }
  .fp-form { border-top:1px solid var(--line); padding-top:10px; display:grid; gap:6px; }
  .fp-row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  .fp-check { display:inline-flex; align-items:center; gap:5px; font-size:13px; color:var(--ink); width:auto; }
  .fp-check input { width:auto; }
  .fp-foot { font-size:12px; color:var(--muted); border-top:1px dashed var(--line); padding-top:8px; }
  .fp-correct { margin-top:16px; }
  .fp-sample { border:1px solid var(--line); border-radius:8px; padding:12px; margin-bottom:10px; background:#fff; }
  .fp-sample h4 { margin:0 0 8px; font-size:14px; }
  @media (max-width:950px){ .fp-wrap{padding:0 16px 16px;} .fp-layout{grid-template-columns:1fr;} }
  `;
}

export function firstPiecePanel() {
  return `
  <div class="fp-wrap">
    <div id="fp-banner"></div>
    <div class="fp-error" id="fp-error"></div>
    <div class="fp-layout">
      <form class="panel fp-create" id="fp-create">
        <h3>换砂轮 · 建待确认单</h3>
        <label>砂轮批号</label><input name="wheelBatch" required>
        <label>冷却水流量（L/min）</label><input name="waterFlow" type="number" min="0.1" step="0.1" required>
        <label>磨盘转速（rpm）</label><input name="discRpm" type="number" min="1" step="1" required>
        <label>操作人</label><input name="operator" required>
        <button style="margin-top:12px">创建待确认单</button>
      </form>
      <section class="panel fp-orders">
        <h3>首件确认单（同一砂轮确认前不接第二张）</h3>
        <div id="fp-orders"></div>
      </section>
    </div>
    <section class="panel fp-correct">
      <h3>样本钻孔 / 岩芯箱 / 染色方法更正（提交后原确认作废并按新值重判）</h3>
      <div id="fp-correct"></div>
    </section>
  </div>`;
}

export function firstPieceClient(rules) {
  const { THICKNESS_MIN_MM, THICKNESS_MAX_MM, PASS_STREAK_TO_RELEASE, ORDER_STATUS } = rules;
  return `
  (function () {
    const ORDER_STATUS = ${JSON.stringify(ORDER_STATUS)};
    const THICKNESS_MIN_MM = ${THICKNESS_MIN_MM};
    const THICKNESS_MAX_MM = ${THICKNESS_MAX_MM};
    const PASS_STREAK_TO_RELEASE = ${PASS_STREAK_TO_RELEASE};
    let fpSamples = [];
    let fpOrders = [];

    function esc(v) {
      return String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
    }
    function fmtTime(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
    }
    async function fpApi(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers: { "Content-Type": "application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "请求失败");
      return data;
    }
    function showError(msg) {
      const el = document.querySelector("#fp-error");
      if (el) el.textContent = msg || "";
    }
    function sliceOptions(selectedId) {
      return fpSamples.map(sample => sample.slices.map(slice =>
        '<option value="' + esc(sample.id + "|" + slice.id) + '"' +
        (selectedId === slice.id ? " selected" : "") + ">" +
        esc(sample.id + " / " + slice.id + "（" + slice.method + "）") + "</option>"
      ).join("")).join("");
    }
    function inspectForm(order) {
      return '<form class="fp-form" data-action="inspect" data-order="' + esc(order.id) + '">' +
        (order.pendingSliceId
          ? '<div class="meta">在机确认片：<b>' + esc(order.pendingSliceId) + "</b>（须先记录该切片「研磨」步骤并通过检查）</div>"
          : '<div class="meta">尚无在机首件：请先在下方样本卡片对首件记录「研磨」步骤，系统会自动绑定。</div>') +
        '<label>送检切片</label><select name="slice" required>' + sliceOptions(order.pendingSliceId) + "</select>" +
        '<label>厚度（mm，合格区间 ' + THICKNESS_MIN_MM + "–" + THICKNESS_MAX_MM + '）</label>' +
        '<input name="thickness" type="number" min="0" step="0.001" required>' +
        '<div class="fp-row"><label class="fp-check"><input type="checkbox" name="scratches"> 有划痕</label>' +
        '<label class="fp-check"><input type="checkbox" name="edgeBurn"> 边缘烧灼</label></div>' +
        '<label>检验人</label><input name="inspector" required>' +
        '<button>登记首件检查</button></form>';
    }
    function regrindForm(order) {
      const last = order.pieces[order.pieces.length - 1];
      const hint = last ? '<div class="meta">复磨须换人，不得与上一研磨人「' + esc(last.grinder) + "」相同</div>" : "";
      return '<form class="fp-form" data-action="regrind" data-order="' + esc(order.id) + '">' + hint +
        '<div class="meta">复磨件：<b>' + esc(order.pendingSliceId || (last && last.sliceId) || "") + "</b>（须为同一片）</div>" +
        '<label>送检切片</label><select name="slice" required>' + sliceOptions(order.pendingSliceId || (last && last.sliceId)) + "</select>" +
        '<label>复磨操作人</label><input name="operator" required>' +
        '<label>复磨后厚度（mm，' + THICKNESS_MIN_MM + "–" + THICKNESS_MAX_MM + '）</label>' +
        '<input name="thickness" type="number" min="0" step="0.001" required>' +
        '<div class="fp-row"><label class="fp-check"><input type="checkbox" name="scratches"> 有划痕</label>' +
        '<label class="fp-check"><input type="checkbox" name="edgeBurn"> 边缘烧灼</label></div>' +
        '<label>检验人</label><input name="inspector" required>' +
        '<button>登记复磨结果</button></form>';
    }
    function renderPiece(p) {
      const verdict = p.result === "达标"
        ? '<span class="ok">达标</span>'
        : '<span class="bad">越界（' + esc(p.defects.join("、")) + "）</span>";
      return '<div class="fp-piece">#' + p.index + " " + esc(p.kind) + " · " + esc(p.sliceId) +
        " · " + verdict + " · 厚度 " + esc(p.thickness) + "mm · 研磨 " + esc(p.grinder) +
        " / 检验 " + esc(p.inspector) + ' <span class="meta">' + esc(fmtTime(p.at)) + "</span></div>";
    }
    function renderOrder(order) {
      const cls = order.status === ORDER_STATUS.PENDING ? "pending"
        : order.status === ORDER_STATUS.REGRIND ? "regrind"
        : order.status === ORDER_STATUS.RELEASED ? "released" : "void";
      let body = "";
      if (order.status === ORDER_STATUS.PENDING) body = inspectForm(order);
      else if (order.status === ORDER_STATUS.REGRIND) body = regrindForm(order);
      else body = '<div class="fp-foot">' +
        (order.status === ORDER_STATUS.RELEASED
          ? "已解除：" + esc(fmtTime(order.releasedAt))
          : "已作废：" + esc(order.voidReason || "")) +
        (order.reopenedFrom ? "<br>由确认单 " + esc(order.reopenedFrom) + " 更正重判产生" : "") +
        "</div>";
      const events = order.events.slice(-5).map(e =>
        '<div>' + esc(fmtTime(e.at)) + " ｜ " + esc(e.type) + "：" + esc(e.note) + "</div>"
      ).join("");
      return '<article class="fp-order"><div class="fp-order-head"><b>' + esc(order.id) +
        ' · 砂轮 ' + esc(order.wheelBatch) + '</b><span class="fp-status ' + cls + '">' +
        esc(order.status) + "</span></div>" +
        '<div class="meta">冷却水 ' + esc(order.waterFlow) + " L/min · 磨盘 " + esc(order.discRpm) +
        " rpm · 操作人 " + esc(order.operator) + "<br>连续达标 " +
        esc(order.consecutivePasses) + "/" + PASS_STREAK_TO_RELEASE +
        " · 建单 " + esc(fmtTime(order.createdAt)) + "</div>" +
        (order.pieces.length ? '<div class="fp-pieces">' + order.pieces.map(renderPiece).join("") + "</div>" : "") +
        body + '<div class="fp-events">' + events + "</div></article>";
    }
    function renderBanner() {
      const banner = document.querySelector("#fp-banner");
      const active = fpOrders.filter(o => o.status === ORDER_STATUS.PENDING || o.status === ORDER_STATUS.REGRIND);
      if (!active.length) {
        banner.className = "fp-banner none";
        banner.textContent = "当前无进行中的首件确认，砂轮已解除，可正常接研磨任务。";
        return;
      }
      banner.className = "fp-banner";
      banner.innerHTML = active.map(o =>
        "⚠ 砂轮 <b>" + esc(o.wheelBatch) + "</b>（" + esc(o.id) + "）首件确认中：" + esc(o.status) +
        "，连续达标 " + esc(o.consecutivePasses) + "/" + PASS_STREAK_TO_RELEASE +
        (o.pendingSliceId ? "，在机确认片 <b>" + esc(o.pendingSliceId) + "</b>" : "，首件尚未上磨") +
        "；同一砂轮确认解除前研磨工序不接第二张。"
      ).join("<br>");
    }
    function renderCorrections() {
      const el = document.querySelector("#fp-correct");
      el.innerHTML = fpSamples.map(sample =>
        '<form class="fp-sample" data-correct="' + esc(sample.id) + '"><h4>' + esc(sample.id) + " · " +
        esc(sample.project) + "</h4>" +
        '<label>钻孔编号</label><input name="borehole" value="' + esc(sample.borehole) + '" required>' +
        '<label>岩芯箱号</label><input name="coreBox" value="' + esc(sample.coreBox) + '" required>' +
        sample.slices.map(slice =>
          '<label>切片 ' + esc(slice.id) + " 染色方法</label>" +
          '<input name="method:' + esc(slice.id) + '" value="' + esc(slice.method) + '" required>'
        ).join("") +
        '<button style="margin-top:10px">保存更正并重判</button></form>'
      ).join("");
    }
    function renderFirstPiece() {
      renderBanner();
      document.querySelector("#fp-orders").innerHTML =
        fpOrders.length ? fpOrders.map(renderOrder).join("") : '<div class="meta">暂无确认单</div>';
      renderCorrections();
    }
    async function reloadFirstPiece() {
      [fpSamples, fpOrders] = await Promise.all([fpApi("/api/samples"), fpApi("/api/first-piece/orders")]);
      renderFirstPiece();
    }
    function inspectPayload(form) {
      const [sampleId, sliceId] = form.elements.slice.value.split("|");
      return { sampleId, sliceId, thickness: Number(form.elements.thickness.value),
        scratches: form.elements.scratches.checked, edgeBurn: form.elements.edgeBurn.checked,
        inspector: form.elements.inspector.value };
    }
    document.querySelector("#fp-create").addEventListener("submit", async (ev) => {
      ev.preventDefault();
      showError("");
      const form = ev.target;
      try {
        await fpApi("/api/first-piece/orders", { method: "POST", body: JSON.stringify({
          wheelBatch: form.elements.wheelBatch.value,
          waterFlow: Number(form.elements.waterFlow.value),
          discRpm: Number(form.elements.discRpm.value),
          operator: form.elements.operator.value,
        }) });
        form.reset();
        await reloadAll();
      } catch (e) { showError(e.message); }
    });
    document.querySelector("#fp-orders").addEventListener("submit", async (ev) => {
      const form = ev.target.closest("form[data-action]");
      if (!form || !ev.target.closest("form[data-action]")) return;
      ev.preventDefault();
      showError("");
      const orderId = form.dataset.order;
      try {
        if (form.dataset.action === "inspect") {
          await fpApi("/api/first-piece/orders/" + encodeURIComponent(orderId) + "/inspections",
            { method: "POST", body: JSON.stringify(inspectPayload(form)) });
        } else {
          const [sampleId, sliceId] = form.elements.slice.value.split("|");
          await fpApi("/api/first-piece/orders/" + encodeURIComponent(orderId) + "/regrinds",
            { method: "POST", body: JSON.stringify({
              sampleId, sliceId, thickness: Number(form.elements.thickness.value),
              scratches: form.elements.scratches.checked, edgeBurn: form.elements.edgeBurn.checked,
              operator: form.elements.operator.value, inspector: form.elements.inspector.value,
            }) });
        }
        await reloadAll();
      } catch (e) { showError(e.message); }
    });
    document.querySelector("#fp-correct").addEventListener("submit", async (ev) => {
      const form = ev.target.closest("form[data-correct]");
      if (!form) return;
      ev.preventDefault();
      showError("");
      const sampleId = form.dataset.correct;
      const methods = {};
      form.querySelectorAll("input[name^='method:']").forEach(input => {
        methods[input.name.slice("method:".length)] = input.value;
      });
      try {
        const result = await fpApi("/api/samples/" + encodeURIComponent(sampleId) + "/correction",
          { method: "PATCH", body: JSON.stringify({
            borehole: form.elements.borehole.value,
            coreBox: form.elements.coreBox.value,
            methods,
          }) });
        showError(result.reopened.length
          ? "已保存更正；作废并按新值重判 " + result.reopened.length + " 张确认单。"
          : "已保存更正（无进行中的关联确认单需重判）。");
        await reloadAll();
      } catch (e) { showError(e.message); }
    });
    window.__initFirstPiece = reloadFirstPiece;
  })();
  `;
}
