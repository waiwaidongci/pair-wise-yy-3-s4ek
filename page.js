// 页面操作 —— HTML 页面与前端交互（建单、首件送检、复磨、解除、更正作废、刷新）
export const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>岩芯样本切片实验室</title>
  <style>
    :root { --bg:#f1f3ef; --panel:#fff; --ink:#242822; --muted:#687062; --line:#d7ddd1; --accent:#526f43; --stone:#73706a; --bad:#9b3a2e; --ok:#3f7a44; --warn:#a8761f; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:16px; }
    h1 { margin:0; font-size:26px; } main { padding:22px 28px; } .top { display:grid; grid-template-columns:390px 1fr; gap:22px; }
    form,.panel,.card,.stat,.ticket { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; background:#fff; } textarea { min-height:68px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; } button[disabled] { opacity:.45; cursor:not-allowed; }
    button.ghost { background:#fff; color:var(--accent); border:1px solid var(--accent); } button.danger { background:var(--bad); }
    .stats { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px; } .stat strong { display:block; font-size:24px; }
    .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:12px; } .card { display:grid; gap:8px; align-content:start; }
    .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.ok { color:var(--ok); border-color:var(--ok); } .pill.bad { color:var(--bad); border-color:var(--bad); } .pill.warn { color:var(--warn); border-color:var(--warn); }
    .slice { border-top:1px solid var(--line); padding-top:10px; }
    .ticketwrap { display:grid; grid-template-columns:340px 1fr; gap:18px; margin-top:22px; } .tickets { display:grid; gap:12px; }
    .ticket { display:grid; gap:8px; align-content:start; } .piece { border-top:1px dashed var(--line); padding-top:8px; margin-top:8px; }
    .reading { font-size:13px; color:var(--muted); } .events { font-size:12px; color:var(--muted); border-top:1px solid var(--line); padding-top:8px; display:grid; gap:3px; }
    .inline { display:grid; grid-template-columns:1fr 1fr; gap:8px; } .toast { position:fixed; right:18px; bottom:18px; background:var(--ink); color:#fff; padding:11px 15px; border-radius:8px; font-size:14px; display:none; max-width:60vw; }
    .toast.bad { background:var(--bad); } .hint { font-size:12px; color:var(--muted); } .row3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; }
    @media (max-width:950px){ header{display:block;padding:18px 16px;} .top,.ticketwrap{grid-template-columns:1fr;padding:0;} main{padding:16px;} .stats{grid-template-columns:1fr 1fr;} }
  </style>
</head>
<body>
  <header><div><h1>岩芯样本切片实验室</h1><div class="meta">样本、切片任务、制片步骤、砂轮首件确认和交付</div></div><button id="reload">刷新</button></header>
  <main>
    <div class="top">
      <form id="form">
        <h2>创建岩芯样本</h2>
        <label>项目</label><input name="project" required>
        <label>钻孔编号</label><input name="borehole" required>
        <label>岩芯箱号</label><input name="coreBox" required>
        <label>取样深度</label><input name="depth" required>
        <label>负责人</label><input name="owner" required>
        <label>初始切片编号</label><input name="sliceId" required>
        <label>染色方法</label><input name="method" required>
        <button>保存样本</button>
      </form>
      <section>
        <div class="stats" id="stats"></div>
        <div class="grid" id="samples"></div>
      </section>
    </div>

    <div class="ticketwrap">
      <form id="confirmForm" class="panel">
        <h2>换砂轮 · 建首件待确认单</h2>
        <div class="hint">同一砂轮批号确认解除前不接第二张；首件查厚度、划痕、边缘烧灼，越界转复磨且复磨换人，连续两片达标才解除。</div>
        <label>砂轮批号</label><input name="wheelBatch" placeholder="如 GW-2026-09A" required>
        <label>冷却水流量</label><input name="coolingFlow" placeholder="如 1.8 L/min" required>
        <label>磨盘转速</label><input name="discSpeed" placeholder="如 1450 rpm" required>
        <label>操作人</label><input name="operator" required>
        <button style="margin-top:12px">建待确认单</button>
      </form>
      <section>
        <h2 style="margin-bottom:10px">砂轮首件确认单</h2>
        <div class="tickets" id="tickets"></div>
      </section>
    </div>
  </main>
  <div class="toast" id="toast"></div>
  <script>
    const statuses = ${JSON.stringify("__STATUSES__")};
    const steps = ${JSON.stringify("__STEPS__")};
    const META = ${JSON.stringify("__META__")};
    const form = document.querySelector("#form");
    const confirmForm = document.querySelector("#confirmForm");
    const stats = document.querySelector("#stats");
    const samplesEl = document.querySelector("#samples");
    const ticketsEl = document.querySelector("#tickets");
    const toastEl = document.querySelector("#toast");
    let samples = [];
    let confirmations = [];

    function esc(value) {
      return String(value === null || value === undefined ? "" : value).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
    }
    let toastTimer = null;
    function toast(message, bad) {
      toastEl.textContent = message;
      toastEl.className = bad ? "toast bad" : "toast";
      toastEl.style.display = "block";
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toastEl.style.display = "none"; }, 3500);
    }
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ "Content-Type":"application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "请求失败");
      return data;
    }
    function val(id) { const el = document.getElementById(id); return el ? el.value.trim() : ""; }
    function num(id) { return Number(val(id)); }

    function thicknessInput(id) {
      return '<input id="'+id+'" type="number" step="0.001" min="0" max="0.1" placeholder="厚度mm，带宽 '+META.min+'–'+META.max+'">';
    }
    function operatorInput(id, placeholder) {
      return '<input id="'+id+'" placeholder="'+(placeholder || "操作人")+'">';
    }

    function trailingPass(ticket) {
      let count = 0;
      for (let i = ticket.pieces.length - 1; i >= 0; i--) {
        if (ticket.pieces[i].status === META.pieceOk) count++; else break;
      }
      return count;
    }
    function hasOpenRegrind(ticket) {
      return ticket.pieces.some(piece => piece.status === META.pieceRegrind);
    }
    function canRelease(ticket) {
      return ticket.status === META.pending && ticket.pieces.length >= META.required && !hasOpenRegrind(ticket) && trailingPass(ticket) >= META.required;
    }
    function statusPill(status) {
      const cls = status === META.released ? "ok" : status === META.ticketVoid ? "bad" : "warn";
      return '<span class="pill '+cls+'">'+esc(status)+'</span>';
    }

    function renderStats() {
      stats.innerHTML = statuses.map(s => '<div class="stat"><span>'+s+'</span><strong>'+samples.filter(item => item.status === s).length+'</strong></div>').join("");
    }

    function renderSamples() {
      samplesEl.innerHTML = samples.map(sample => {
        const cards = sample.slices.map(slice =>
          '<div class="slice"><b>'+esc(slice.id)+'</b><div class="meta">'+esc(slice.method)+' · 当前步骤 '+esc(slice.status)+'</div>'
          + '<select data-step="'+sample.id+'|'+slice.id+'">'+steps.map(step => '<option>'+esc(step)+'</option>').join("")+'</select>'
          + '<textarea data-note="'+sample.id+'|'+slice.id+'" placeholder="步骤备注或观察结果"></textarea>'
          + '<button type="button" class="ghost" data-action="log" data-key="'+sample.id+'|'+slice.id+'">记录步骤</button>'
          + '<label>染色方法更正（更正后关联首件确认作废重判）</label>'
          + '<div class="inline"><input data-methodfix="'+sample.id+'|'+slice.id+'" placeholder="新染色方法" value="'+esc(slice.method)+'">'
          + '<button type="button" class="ghost" data-action="methodfix" data-key="'+sample.id+'|'+slice.id+'">更正染色</button></div>'
          + '<div class="meta">'+slice.logs.map(log => esc(log.step+"："+log.note)).join(" / ")+'</div></div>'
        ).join("");
        return '<article class="card"><h3>'+esc(sample.project)+'</h3><span class="pill">'+esc(sample.status)+'</span>'
          + '<div class="meta">'+esc(sample.borehole)+' · '+esc(sample.coreBox)+' · '+esc(sample.depth)+' · '+esc(sample.owner)+'</div>'
          + '<label>新增切片</label><div class="inline"><input data-new-slice="'+sample.id+'" placeholder="切片编号"><input data-method="'+sample.id+'" placeholder="染色方法"></div>'
          + '<button type="button" data-action="addslice" data-sample="'+sample.id+'">添加切片</button>'
          + '<label>钻孔 / 岩芯箱更正（更正后关联首件确认作废重判）</label>'
          + '<div class="inline"><input data-borehole="'+sample.id+'" placeholder="新钻孔编号" value="'+esc(sample.borehole)+'"><input data-corebox="'+sample.id+'" placeholder="新岩芯箱号" value="'+esc(sample.coreBox)+'"></div>'
          + '<button type="button" class="ghost" data-action="samplefix" data-sample="'+sample.id+'">更正钻孔/岩芯箱</button>'
          + cards
          + '<button type="button" data-action="deliver" data-sample="'+sample.id+'">标记交付</button></article>';
      }).join("");
      document.querySelectorAll("[data-step]").forEach(sel => {
        const [sampleId, sliceId] = sel.dataset.step.split("|");
        const slice = samples.find(s => s.id === sampleId).slices.find(s => s.id === sliceId);
        sel.value = slice.status;
      });
    }

    function readingLine(reading, prefix) {
      const result = reading.ok ? '<span class="pill ok">达标</span>' : '<span class="pill bad">越界</span> '+(reading.reasons || []).map(esc).join("、");
      const th = reading.thickness === null ? "未填" : reading.thickness+"mm";
      return '<div class="reading">'+esc(prefix || "")+'厚度 '+esc(th)+'（'+(reading.thicknessOk ? "合格" : "越界")+'） · 划痕 '+esc(reading.scratches)+' · 边缘烧灼 '+esc(reading.edgeBurn)+' · '+result+'</div>';
    }
    function renderTickets() {
      const ordered = confirmations.slice().sort((a, b) => {
        const rank = t => t.status === META.pending ? 0 : t.status === META.released ? 1 : 2;
        return rank(a) - rank(b) || (a.createdAt < b.createdAt ? 1 : -1);
      });
      if (!ordered.length) {
        ticketsEl.innerHTML = '<div class="panel meta">暂无确认单。换砂轮后请在左侧建立待确认单。</div>';
        return;
      }
      ticketsEl.innerHTML = ordered.map(ticket => {
        const pieces = ticket.pieces.map(piece => {
          const rows = piece.readings.map((r, i) => readingLine(r, (r.regrind ? "复磨" : "首检") + (i + 1) + " · ")).join("");
          const regrinds = piece.regrinds.length ? '<div class="meta">复磨：' + piece.regrinds.map(r => esc(r.at.slice(0,16).replace("T"," "))+" "+esc(r.operator)).join(" → ")+'</div>' : '';
          let action = '';
          if (ticket.status === META.pending && piece.status === META.pieceRegrind) {
            const rid = 'rg-'+ticket.id+'-'+piece.id;
            action = '<label>复磨送检（须换人）</label><div class="inline">'+operatorInput(rid+'-op', '复磨操作人')+thicknessInput(rid+'-th')+'</div>'
              + '<div class="inline"><div><label style="margin:0">划痕</label><select id="'+rid+'-sc"><option value="无">无</option><option value="有">有</option></select></div>'
              + '<div><label style="margin:0">边缘烧灼</label><select id="'+rid+'-eb"><option value="无">无</option><option value="有">有</option></select></div></div>'
              + '<button type="button" class="danger" data-action="regrind" data-ticket="'+ticket.id+'" data-piece="'+piece.id+'">复磨换人重判</button>';
          }
          return '<div class="piece"><b>'+esc(piece.sliceId || piece.id)+'</b> <span class="pill '+(piece.status === META.pieceOk ? "ok" : "bad")+'">'+esc(piece.status)+'</span><div class="meta">首件操作人 '+esc(piece.operator)+'</div>'+rows+regrinds+action+'</div>';
        }).join("");
        const inspect = ticket.status === META.pending
          ? '<label>首件/续片送检（查厚度、划痕、边缘烧灼）</label>'
            + '<div class="row3"><input id="in-'+ticket.id+'-sl" placeholder="薄片编号">'+operatorInput('in-'+ticket.id+'-op','操作人')+thicknessInput('in-'+ticket.id+'-th')+'</div>'
            + '<div class="row3"><div><label style="margin:0">划痕</label><select id="in-'+ticket.id+'-sc"><option value="无">无</option><option value="有">有</option></select></div>'
            + '<div><label style="margin:0">边缘烧灼</label><select id="in-'+ticket.id+'-eb"><option value="无">无</option><option value="有">有</option></select></div><span></span></div>'
            + '<button type="button" data-action="inspect" data-ticket="'+ticket.id+'">登记首件判定</button>'
          : '';
        const release = ticket.status === META.pending
          ? '<div class="meta">最近连续达标 '+trailingPass(ticket)+' / '+META.required+' 片'+(hasOpenRegrind(ticket) ? '，尚有转复磨片未闭环' : '')+'</div>'
            + '<button type="button" data-action="release" data-ticket="'+ticket.id+'" '+(canRelease(ticket) ? '' : 'disabled')+'>解除首件确认</button>'
          : (ticket.voidReason ? '<div class="meta">作废原因：'+esc(ticket.voidReason)+'</div>' : '<div class="meta">解除时间 '+esc((ticket.releasedAt||"").replace("T"," ").slice(0,16))+'</div>');
        const events = '<div class="events">'+ticket.events.map(e => '<div>'+esc(e.at.slice(0,16).replace("T"," "))+' · '+esc(e.type)+'：'+esc(e.note)+'</div>').join("")+'</div>';
        return '<article class="ticket"><h3>砂轮 '+esc(ticket.wheelBatch)+' '+statusPill(ticket.status)+'</h3>'
          + '<div class="meta">冷却水 '+esc(ticket.coolingFlow)+' · 磨盘 '+esc(ticket.discSpeed)+' · 操作人 '+esc(ticket.operator)+'</div>'
          + '<div class="meta">建单 '+esc(ticket.createdAt.slice(0,16).replace("T"," "))+'</div>'
          + inspect + pieces + release + events + '</article>';
      }).join("");
    }

    async function load() {
      try {
        const [sampleData, ticketData] = await Promise.all([api("/api/samples"), api("/api/confirmations")]);
        samples = sampleData;
        confirmations = ticketData;
        renderStats(); renderSamples(); renderTickets();
      } catch (error) { toast(error.message, true); }
    }

    document.addEventListener("click", async event => {
      const btn = event.target.closest("button[data-action]");
      if (!btn) return;
      try {
        const action = btn.dataset.action;
        if (action === "addslice") {
          const id = btn.dataset.sample;
          await api('/api/samples/'+id+'/slices', { method:'POST', body: JSON.stringify({ id: document.querySelector('[data-new-slice="'+id+'"]').value, method: document.querySelector('[data-method="'+id+'"]').value || "未指定" }) });
        } else if (action === "log") {
          const [sampleId, sliceId] = btn.dataset.key.split("|");
          await api('/api/samples/'+sampleId+'/slices/'+sliceId+'/logs', { method:'POST', body: JSON.stringify({ step: document.querySelector('[data-step="'+sampleId+'|'+sliceId+'"]').value, note: document.querySelector('[data-note="'+sampleId+'|'+sliceId+'"]').value || "步骤完成" }) });
        } else if (action === "deliver") {
          await api('/api/samples/'+btn.dataset.sample+'/deliver', { method:'POST', body: JSON.stringify({}) });
        } else if (action === "samplefix") {
          const id = btn.dataset.sample;
          await api('/api/samples/'+id, { method:'PATCH', body: JSON.stringify({ borehole: document.querySelector('[data-borehole="'+id+'"]').value, coreBox: document.querySelector('[data-corebox="'+id+'"]').value }) });
          toast("已更正；关联的未解除首件确认已作废，需按新值重新建单确认");
        } else if (action === "methodfix") {
          const [sampleId, sliceId] = btn.dataset.key.split("|");
          await api('/api/samples/'+sampleId+'/slices/'+sliceId+'/method', { method:'PATCH', body: JSON.stringify({ method: document.querySelector('[data-methodfix="'+sampleId+'|'+sliceId+'"]').value }) });
          toast("染色方法已更正；关联首件确认已作废，按新值重判");
        } else if (action === "inspect") {
          const t = btn.dataset.ticket, p = "in-"+t+"-";
          const payload = { sliceId: val(p+"sl"), operator: val(p+"op"), thickness: num(p+"th"), scratches: val(p+"sc"), edgeBurn: val(p+"eb") };
          const result = await api('/api/confirmations/'+t+'/pieces', { method:'POST', body: JSON.stringify(payload) });
          toast(result.reading.ok ? "首件达标，已记录" : "越界转复磨：" + result.reading.reasons.join("、"), !result.reading.ok);
        } else if (action === "regrind") {
          const t = btn.dataset.ticket, piece = btn.dataset.piece, p = "rg-"+t+"-"+piece+"-";
          const payload = { operator: val(p+"op"), thickness: num(p+"th"), scratches: val(p+"sc"), edgeBurn: val(p+"eb") };
          const result = await api('/api/confirmations/'+t+'/pieces/'+piece+'/regrind', { method:'POST', body: JSON.stringify(payload) });
          toast(result.reading.ok ? "复磨达标" : "复磨仍越界：" + result.reading.reasons.join("、"), !result.reading.ok);
        } else if (action === "release") {
          await api('/api/confirmations/'+btn.dataset.ticket+'/release', { method:'POST', body: JSON.stringify({}) });
          toast("连续两片达标，首件确认已解除");
        }
        await load();
      } catch (error) { toast(error.message, true); }
    });

    document.querySelector("#reload").onclick = load;
    form.onsubmit = async event => {
      event.preventDefault();
      try {
        await api("/api/samples", { method:"POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
        form.reset(); await load();
      } catch (error) { toast(error.message, true); }
    };
    confirmForm.onsubmit = async event => {
      event.preventDefault();
      try {
        await api("/api/confirmations", { method:"POST", body: JSON.stringify(Object.fromEntries(new FormData(confirmForm).entries())) });
        confirmForm.reset(); toast("待确认单已建立，可登记首件"); await load();
      } catch (error) { toast(error.message, true); }
    };
    load();
  </script>
</body>
</html>`;
