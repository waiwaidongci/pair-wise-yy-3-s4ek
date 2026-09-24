// 开机首件确认 —— 确认规则
// 换砂轮后建待确认单，记录砂轮批号、冷却水流量、磨盘转速、操作人；
// 同一砂轮确认前不接第二张；首件检查厚度、划痕、边缘烧灼；
// 越界转复磨，复磨换人；连续两片达标才解除；
// 样本钻孔、岩芯箱或染色方法更正后，原确认作废并按新值重判。
//
// 本文件只放规则，不读写文件（记录保存见 ./firstPieceRecords.js），
// 也不放页面代码（见 ./firstPiecePage.js）。

// 薄片厚度标准 0.03mm，判定带 0.028–0.032mm；且不得有划痕、边缘烧灼。
export const THICKNESS_MIN_MM = 0.028;
export const THICKNESS_MAX_MM = 0.032;
export const PASS_STREAK_TO_RELEASE = 2;

export const ORDER_STATUS = Object.freeze({
  PENDING: "待确认",
  REGRIND: "复磨中",
  RELEASED: "已解除",
  VOID: "已作废",
});

const ACTIVE_STATUSES = [ORDER_STATUS.PENDING, ORDER_STATUS.REGRIND];

const FIELD_LABELS = { borehole: "钻孔", coreBox: "岩芯箱", method: "染色方法" };

export class FirstPieceRuleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "FirstPieceRuleError";
    this.code = code;
  }
}

export const isActive = (order) => ACTIVE_STATUSES.includes(order.status);

function ts(now) {
  return (now instanceof Date ? now : new Date()).toISOString();
}

function recordId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// 单片刻痕/烧灼/厚度判定
export function judgePiece(input) {
  const defects = [];
  const thickness = Number(input.thickness);
  if (!Number.isFinite(thickness) || thickness < THICKNESS_MIN_MM || thickness > THICKNESS_MAX_MM) {
    defects.push("厚度越界");
  }
  if (input.scratches) defects.push("划痕");
  if (input.edgeBurn) defects.push("边缘烧灼");
  return { thickness: Number.isFinite(thickness) ? thickness : null, defects, pass: defects.length === 0 };
}

// 换件后建待确认单；同一砂轮只允许一张未结束的确认单
export function createOrder(input, existingOrders = [], now = new Date()) {
  const wheelBatch = String(input.wheelBatch ?? "").trim();
  const waterFlow = Number(input.waterFlow);
  const discRpm = Number(input.discRpm);
  const operator = String(input.operator ?? "").trim();
  if (!wheelBatch) throw new FirstPieceRuleError("wheel_batch_required", "砂轮批号必填");
  if (!Number.isFinite(waterFlow) || waterFlow <= 0) {
    throw new FirstPieceRuleError("water_flow_invalid", "冷却水流量必须为正数（L/min）");
  }
  if (!Number.isFinite(discRpm) || discRpm <= 0) {
    throw new FirstPieceRuleError("disc_rpm_invalid", "磨盘转速必须为正数（rpm）");
  }
  if (!operator) throw new FirstPieceRuleError("operator_required", "操作人必填");
  if (existingOrders.some((o) => o.wheelBatch === wheelBatch && isActive(o)) && !input.__reopen) {
    throw new FirstPieceRuleError("wheel_batch_active", "同一砂轮确认尚未完成，不能重复建待确认单");
  }
  const at = ts(now);
  return {
    id: recordId("FP"),
    wheelBatch,
    waterFlow,
    discRpm,
    operator,
    status: ORDER_STATUS.PENDING,
    consecutivePasses: 0,
    pendingSampleId: null,
    pendingSliceId: null,
    pieces: [],
    events: [
      {
        at,
        type: "换件建单",
        note: `砂轮批号 ${wheelBatch}；冷却水 ${waterFlow} L/min；磨盘 ${discRpm} rpm；操作人 ${operator}`,
      },
    ],
    createdAt: at,
    releasedAt: null,
    voidReason: null,
    reopenedFrom: null,
    sampleSnapshot: null,
  };
}

function snapshotOf(sample, slice) {
  return { sampleId: sample.id, borehole: sample.borehole, coreBox: sample.coreBox, method: slice.method };
}

function release(order, at) {
  order.status = ORDER_STATUS.RELEASED;
  order.releasedAt = at;
  order.events.push({ at, type: "确认解除", note: `连续 ${order.consecutivePasses} 片达标，砂轮 ${order.wheelBatch} 准予正常接单` });
}

// 首件/确认片送检：待确认状态下登记一片的检查结果。
// 送检切片必须与当前在机的待确认切片一致（由研磨步骤记录时绑定）。
export function submitInspection(order, input, refs, now = new Date()) {
  if (!isActive(order)) throw new FirstPieceRuleError("order_not_active", "确认单已结束，不能再登记首件");
  if (order.status === ORDER_STATUS.REGRIND) {
    throw new FirstPieceRuleError("regrind_required", "上一片越界，须先换人复磨并登记复磨结果");
  }
  if (!refs?.sample || !refs?.slice) {
    throw new FirstPieceRuleError("slice_required", "送检件必须关联样本切片");
  }
  if (!order.pendingSliceId) {
    throw new FirstPieceRuleError(
      "piece_not_ground",
      "首件尚未上磨：请先在样本卡片对该切片记录「研磨」步骤，完成后再登记检查"
    );
  }
  if (refs.slice.id !== order.pendingSliceId ||
      (order.pendingSampleId && refs.sample.id !== order.pendingSampleId)) {
    throw new FirstPieceRuleError(
      "slice_not_pending",
      `当前应送检 ${order.pendingSliceId}，不能先登记其他切片；同一砂轮确认前不接第二张`
    );
  }
  const grinder = String(input.operator ?? order.operator).trim() || order.operator;
  const inspector = String(input.inspector ?? "").trim();
  if (!inspector) throw new FirstPieceRuleError("inspector_required", "检验人必填");

  const verdict = judgePiece(input);
  if (verdict.thickness === null) throw new FirstPieceRuleError("thickness_invalid", "厚度数值无效");
  const at = ts(now);
  const isFirst = order.pieces.length === 0;
  order.pieces.push({
    index: order.pieces.length + 1,
    kind: isFirst ? "首件" : "确认片",
    sampleId: refs.sample.id,
    sliceId: refs.slice.id,
    thickness: verdict.thickness,
    scratches: Boolean(input.scratches),
    edgeBurn: Boolean(input.edgeBurn),
    grinder,
    inspector,
    result: verdict.pass ? "达标" : "越界",
    defects: verdict.defects,
    sampleSnapshot: snapshotOf(refs.sample, refs.slice),
    at,
  });
  order.pendingSampleId = null;
  order.pendingSliceId = null;

  if (verdict.pass) {
    order.consecutivePasses += 1;
    order.events.push({
      at,
      type: isFirst ? "首件达标" : "确认片达标",
      note: `${refs.slice.id} 厚度 ${verdict.thickness}mm 达标，连续达标 ${order.consecutivePasses}/${PASS_STREAK_TO_RELEASE}`,
    });
    if (order.consecutivePasses >= PASS_STREAK_TO_RELEASE) release(order, at);
  } else {
    order.consecutivePasses = 0;
    order.status = ORDER_STATUS.REGRIND;
    // 越界片仍是当前待处理件，复磨后须重新送检同一片
    order.pendingSampleId = refs.sample.id;
    order.pendingSliceId = refs.slice.id;
    order.events.push({
      at,
      type: isFirst ? "首件越界" : "确认片越界",
      note: `${refs.slice.id} ${verdict.defects.join("、")}，转复磨；复磨人不得为 ${grinder}`,
    });
  }
  return order;
}

// 复磨送检：必须换人，且复磨的是当前越界待处理的同一片；复磨后重新判定。
export function submitRegrind(order, input, refs, now = new Date()) {
  if (order.status !== ORDER_STATUS.REGRIND) {
    throw new FirstPieceRuleError("not_in_regrind", "当前确认单不在复磨状态");
  }
  const operator = String(input.operator ?? "").trim();
  const inspector = String(input.inspector ?? "").trim();
  if (!operator) throw new FirstPieceRuleError("operator_required", "复磨操作人必填");
  if (!inspector) throw new FirstPieceRuleError("inspector_required", "检验人必填");
  if (!refs?.sample || !refs?.slice) {
    throw new FirstPieceRuleError("slice_required", "复磨件必须关联样本切片");
  }
  const lastPiece = order.pieces[order.pieces.length - 1];
  if (lastPiece && operator === lastPiece.grinder) {
    throw new FirstPieceRuleError("regrind_operator_same", `复磨须换人，不能与上一研磨人 ${lastPiece.grinder} 相同`);
  }
  if (order.pendingSliceId && (refs.slice.id !== order.pendingSliceId ||
      (order.pendingSampleId && refs.sample.id !== order.pendingSampleId))) {
    throw new FirstPieceRuleError(
      "slice_not_pending",
      `越界片 ${order.pendingSliceId} 尚未复磨，不能改磨其他切片`
    );
  }

  const verdict = judgePiece(input);
  if (verdict.thickness === null) throw new FirstPieceRuleError("thickness_invalid", "厚度数值无效");
  const at = ts(now);
  order.pieces.push({
    index: order.pieces.length + 1,
    kind: "复磨",
    sampleId: refs.sample.id,
    sliceId: refs.slice.id,
    thickness: verdict.thickness,
    scratches: Boolean(input.scratches),
    edgeBurn: Boolean(input.edgeBurn),
    grinder: operator,
    inspector,
    result: verdict.pass ? "达标" : "越界",
    defects: verdict.defects,
    sampleSnapshot: snapshotOf(refs.sample, refs.slice),
    at,
  });

  if (verdict.pass) {
    // 复磨只恢复 1 片连达，仍需再来一片才能解除
    order.consecutivePasses = 1;
    order.status = ORDER_STATUS.PENDING;
    order.pendingSampleId = null;
    order.pendingSliceId = null;
    order.events.push({
      at,
      type: "复磨达标",
      note: `${refs.slice.id} 由 ${operator} 复磨达标，连续达标 1/${PASS_STREAK_TO_RELEASE}，仍需再验一片`,
    });
  } else {
    order.consecutivePasses = 0;
    // 继续复磨仍须换人，基准更新为最新一位复磨人
    order.events.push({
      at,
      type: "复磨仍越界",
      note: `${refs.slice.id} ${verdict.defects.join("、")}，继续复磨且须再次换人（不得为 ${operator}）`,
    });
  }
  return order;
}

// 研磨工序接单闸门 + 绑定：同一砂轮确认前不接第二张。
// - 无进行中确认单：正常放行，返回 null；
// - 有确认单且尚无在机片：本次上磨片绑定为首件，放行；
// - 在机片与本次一致：视为继续加工，放行；
// - 换磨其他片：拒绝（错误码 first_piece_pending）。
// 返回承接该切片的确认单，供调用方落日志。
export function registerGrinding(orders, refs, now = new Date()) {
  if (!refs?.sample || !refs?.slice) {
    throw new FirstPieceRuleError("slice_required", "研磨必须关联样本切片");
  }
  const order = orders.filter(isActive).sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!order) return null;
  const at = ts(now);
  if (!order.pendingSliceId) {
    order.pendingSampleId = refs.sample.id;
    order.pendingSliceId = refs.slice.id;
    order.events.push({
      at,
      type: order.pieces.length === 0 ? "首件上磨" : "确认片上磨",
      note: `${refs.slice.id} 绑定为砂轮 ${order.wheelBatch} 的在机确认片，确认解除前不接第二张`,
    });
    return order;
  }
  if (refs.slice.id === order.pendingSliceId && refs.sample.id === order.pendingSampleId) {
    return order;
  }
  const why = order.status === ORDER_STATUS.REGRIND
    ? `越界片 ${order.pendingSliceId} 待换人复磨，不能换片`
    : `在机确认片 ${order.pendingSliceId} 尚未通过确认，不能换片`;
  throw new FirstPieceRuleError(
    "first_piece_pending",
    `砂轮 ${order.wheelBatch} 首件确认未解除（确认单 ${order.id}）：${why}，不接第二张`
  );
}

// 样本钻孔、岩芯箱、染色方法更正：返回更新后的样本副本与变更清单。
// updates.methods 可按切片逐张给出新染色方法：{ [sliceId]: method }。
export function correctSampleInfo(sample, updates) {
  const next = { ...sample, slices: sample.slices.map((s) => ({ ...s })) };
  const changed = [];
  for (const field of ["borehole", "coreBox"]) {
    if (updates[field] === undefined) continue;
    const value = String(updates[field]).trim();
    if (!value) throw new FirstPieceRuleError(`${field}_required`, `${FIELD_LABELS[field]}不能为空`);
    if (value !== sample[field]) changed.push({ field, from: sample[field], to: value });
    next[field] = value;
  }
  if (updates.methods && typeof updates.methods === "object") {
    for (const slice of next.slices) {
      const raw = updates.methods[slice.id];
      if (raw === undefined) continue;
      const value = String(raw).trim();
      if (!value) throw new FirstPieceRuleError("method_required", `切片 ${slice.id} 染色方法不能为空`);
      if (value !== slice.method) {
        changed.push({ field: "method", sliceId: slice.id, from: slice.method, to: value });
      }
      slice.method = value;
    }
  }
  return { sample: next, changed };
}

// 原确认作废并按新值重判：关联该样本且未结束的确认单一律作废，
// 沿用同一砂轮参数重开待确认单。返回作废/重开对应关系。
export function rejudgeOnCorrection(orders, sample, changed, now = new Date()) {
  if (!changed.length) return [];
  const targets = orders.filter(
    (o) =>
      isActive(o) &&
      (o.pendingSampleId === sample.id || o.pieces.some((p) => p.sampleId === sample.id))
  );
  if (!targets.length) return [];
  const at = ts(now);
  const changeText = changed
    .map((c) => c.field === "method"
      ? `切片 ${c.sliceId} 染色方法 ${c.from} → ${c.to}`
      : `${FIELD_LABELS[c.field]} ${c.from} → ${c.to}`)
    .join("；");
  const methods = [...new Set(sample.slices.map((s) => s.method))].join(" / ");
  const newSnapshot = {
    sampleId: sample.id,
    borehole: sample.borehole,
    coreBox: sample.coreBox,
    methods,
  };

  const reopened = [];
  for (const old of targets) {
    old.status = ORDER_STATUS.VOID;
    old.voidReason = `样本信息更正，原确认作废：${changeText}`;
    old.events.push({ at, type: "确认作废", note: old.voidReason });

    // 旧单已置为作废，同批号不再冲突，可沿用砂轮参数重开
    const fresh = createOrder(
      { wheelBatch: old.wheelBatch, waterFlow: old.waterFlow, discRpm: old.discRpm, operator: old.operator, __reopen: true },
      orders,
      now
    );
    fresh.reopenedFrom = old.id;
    fresh.sampleSnapshot = newSnapshot;
    fresh.events.push({
      at,
      type: "按新值重判",
      note: `原确认单 ${old.id} 关联样本 ${sample.id} 信息更正；按新值重判（钻孔 ${sample.borehole}｜岩芯箱 ${sample.coreBox}｜染色方法 ${methods}）`,
    });
    orders.push(fresh);
    reopened.push({ voidedId: old.id, newOrderId: fresh.id });
  }
  return reopened;
}
