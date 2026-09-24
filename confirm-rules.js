// 砂轮开机首件确认 —— 确认规则（纯业务规则，不读写文件、不碰 HTTP/DOM）
// 切片室换砂轮后首批薄片易带烧边或划痕，故换件后先建待确认单，
// 首件查厚度、划痕、边缘烧灼；越界转复磨且复磨换人，连续两片达标才解除。

// 标准岩矿薄片厚 0.03mm，首件允许带宽 0.027–0.033mm
export const TARGET_THICKNESS_MM = 0.03;
export const THICKNESS_MIN_MM = 0.027;
export const THICKNESS_MAX_MM = 0.033;
// 连续达标片数：两片
export const REQUIRED_CONSECUTIVE_PASS = 2;

export const TICKET_PENDING = "待确认";
export const TICKET_RELEASED = "已解除";
export const TICKET_VOID = "已作废";
export const PIECE_OK = "达标";
export const PIECE_REGRIND = "转复磨";
export const DEFECT_NONE = "无";
export const DEFECT_FOUND = "有";

const nowIso = () => new Date().toISOString();
const genId = prefix => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function ruleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
function requireText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw ruleError("invalid_input", `请填写${field}`);
  return value.trim();
}
function recordEvent(ticket, type, note) {
  ticket.events.push({ at: nowIso(), type, note });
}
function getTicket(db, ticketId) {
  const ticket = db.confirmations.find(item => item.id === ticketId);
  if (!ticket) throw ruleError("ticket_not_found", "首件确认单不存在");
  return ticket;
}
function ensurePending(ticket) {
  if (ticket.status !== TICKET_PENDING) throw ruleError("ticket_not_pending", `确认单已${ticket.status}，不能再登记首件`);
}

// 该砂轮批号是否已有待确认单
export function findActiveTicket(db, wheelBatch) {
  return db.confirmations.find(ticket => ticket.wheelBatch === wheelBatch && ticket.status === TICKET_PENDING);
}

// 判定一片薄片：厚度在带宽内、无划痕、无边缘烧灼才算达标
export function judgeReading(input) {
  const thicknessMm = Number(input.thickness);
  const thicknessOk = Number.isFinite(thicknessMm) && thicknessMm >= THICKNESS_MIN_MM && thicknessMm <= THICKNESS_MAX_MM;
  const scratches = input.scratches === DEFECT_NONE ? DEFECT_NONE : DEFECT_FOUND;
  const edgeBurn = input.edgeBurn === DEFECT_NONE ? DEFECT_NONE : DEFECT_FOUND;
  const scratchesOk = scratches === DEFECT_NONE;
  const edgeBurnOk = edgeBurn === DEFECT_NONE;
  const reasons = [];
  if (!Number.isFinite(thicknessMm)) reasons.push("厚度未填或不是数值");
  else if (!thicknessOk) reasons.push(`厚度 ${thicknessMm}mm 越界（允许 ${THICKNESS_MIN_MM}–${THICKNESS_MAX_MM}mm）`);
  if (!scratchesOk) reasons.push("存在划痕");
  if (!edgeBurnOk) reasons.push("边缘烧灼");
  return {
    thickness: Number.isFinite(thicknessMm) ? thicknessMm : null,
    thicknessOk,
    scratches,
    scratchesOk,
    edgeBurn,
    edgeBurnOk,
    ok: thicknessOk && scratchesOk && edgeBurnOk,
    reasons
  };
}

// 末尾连续达标片数
export function trailingPassCount(ticket) {
  let count = 0;
  for (let i = ticket.pieces.length - 1; i >= 0; i--) {
    if (ticket.pieces[i].status === PIECE_OK) count += 1;
    else break;
  }
  return count;
}
function hasOpenRegrind(ticket) {
  return ticket.pieces.some(piece => piece.status === PIECE_REGRIND);
}
// 解除条件：待确认、至少两片、无遗留复磨、最近连续两片达标
export function releasable(ticket) {
  return ticket.status === TICKET_PENDING
    && ticket.pieces.length >= REQUIRED_CONSECUTIVE_PASS
    && !hasOpenRegrind(ticket)
    && trailingPassCount(ticket) >= REQUIRED_CONSECUTIVE_PASS;
}

// 换砂轮后建待确认单：记录砂轮批号、冷却水流量、磨盘转速、操作人。
// 同一砂轮确认前不接第二张（待确认单）。
export function createConfirmation(db, input) {
  const wheelBatch = requireText(input.wheelBatch, "砂轮批号");
  const coolingFlow = requireText(input.coolingFlow, "冷却水流量");
  const discSpeed = requireText(input.discSpeed, "磨盘转速");
  const operator = requireText(input.operator, "操作人");
  if (findActiveTicket(db, wheelBatch)) {
    throw ruleError("wheel_pending", `砂轮批号 ${wheelBatch} 已有待确认单，确认解除前不接第二张`);
  }
  const ticket = {
    id: genId("FC"),
    wheelBatch,
    coolingFlow,
    discSpeed,
    operator,
    status: TICKET_PENDING,
    createdAt: nowIso(),
    releasedAt: null,
    voidedAt: null,
    voidReason: "",
    pieces: [],
    events: []
  };
  recordEvent(ticket, "建单", `换砂轮建待确认单：冷却水 ${coolingFlow}，磨盘 ${discSpeed}，操作人 ${operator}`);
  db.confirmations.push(ticket);
  return ticket;
}

// 首件/续片送检：查厚度、划痕、边缘烧灼；越界即转复磨
export function inspectFirstPiece(db, ticketId, input) {
  const ticket = getTicket(db, ticketId);
  ensurePending(ticket);
  const operator = requireText(input.operator, "操作人");
  const sliceId = typeof input.sliceId === "string" ? input.sliceId.trim() : "";
  const reading = judgeReading(input);
  const piece = {
    id: genId("FP"),
    sliceId,
    operator,
    status: reading.ok ? PIECE_OK : PIECE_REGRIND,
    createdAt: nowIso(),
    readings: [{ at: nowIso(), ...reading }],
    regrinds: []
  };
  ticket.pieces.push(piece);
  recordEvent(
    ticket,
    "送检",
    `薄片 ${sliceId || "未编号"}（${operator}）${reading.ok ? "达标" : "越界转复磨：" + reading.reasons.join("、")}`
  );
  return { ticket, piece, reading };
}

// 复磨换人：复磨操作人必须不同于上一棒操作人；复磨后按厚度/划痕/烧灼重判
export function regrindPiece(db, ticketId, pieceId, input) {
  const ticket = getTicket(db, ticketId);
  ensurePending(ticket);
  const piece = ticket.pieces.find(item => item.id === pieceId);
  if (!piece) throw ruleError("piece_not_found", "首件记录不存在");
  if (piece.status !== PIECE_REGRIND) throw ruleError("piece_not_regrind", "该薄片当前不处于转复磨状态");
  const previousOperator = piece.regrinds.length ? piece.regrinds[piece.regrinds.length - 1].operator : piece.operator;
  const operator = requireText(input.operator, "复磨操作人");
  if (operator === previousOperator) throw ruleError("regrind_operator_same", `复磨须换人，不能仍由 ${operator} 复磨`);
  const reading = judgeReading(input);
  piece.regrinds.push({ at: nowIso(), operator });
  piece.readings.push({ at: nowIso(), regrind: true, ...reading });
  piece.status = reading.ok ? PIECE_OK : PIECE_REGRIND;
  recordEvent(
    ticket,
    "复磨",
    `${piece.sliceId || piece.id} 改由 ${operator} 复磨，${reading.ok ? "复磨达标" : "仍越界：" + reading.reasons.join("、")}`
  );
  return { ticket, piece, reading };
}

// 连续两片达标才解除
export function releaseConfirmation(db, ticketId) {
  const ticket = getTicket(db, ticketId);
  ensurePending(ticket);
  if (!releasable(ticket)) {
    throw ruleError("not_releasable", `需最近连续 ${REQUIRED_CONSECUTIVE_PASS} 片达标且无遗留复磨（当前连续 ${trailingPassCount(ticket)} 片）`);
  }
  ticket.status = TICKET_RELEASED;
  ticket.releasedAt = nowIso();
  recordEvent(ticket, "解除", `连续 ${trailingPassCount(ticket)} 片达标，砂轮 ${ticket.wheelBatch} 解除首件确认`);
  return ticket;
}

function voidTicket(ticket, reason) {
  if (ticket.status === TICKET_VOID) return false;
  ticket.status = TICKET_VOID;
  ticket.voidedAt = nowIso();
  ticket.voidReason = reason;
  recordEvent(ticket, "作废", reason);
  return true;
}
function voidTicketsUsingSlices(db, sliceIds, reason) {
  const voided = [];
  const wanted = new Set(sliceIds.filter(Boolean));
  if (!wanted.size) return voided;
  for (const ticket of db.confirmations) {
    if (ticket.status === TICKET_VOID) continue;
    if (ticket.pieces.some(piece => piece.sliceId && wanted.has(piece.sliceId))) {
      if (voidTicket(ticket, reason)) voided.push(ticket.id);
    }
  }
  return voided;
}

// 样本钻孔、岩芯箱更正：原确认作废，按新值重判（需重新建单确认）
export function correctSample(db, sampleId, patch) {
  const sample = db.samples.find(item => item.id === sampleId);
  if (!sample) throw ruleError("sample_not_found", "样本不存在");
  const voided = [];
  const fields = [
    { key: "borehole", label: "钻孔" },
    { key: "coreBox", label: "岩芯箱" }
  ];
  for (const field of fields) {
    const next = typeof patch[field.key] === "string" ? patch[field.key].trim() : "";
    if (next && next !== sample[field.key]) {
      const reason = `样本${field.label}由「${sample[field.key]}」更正为「${next}」，原确认作废，按新值重判`;
      voided.push(...voidTicketsUsingSlices(db, sample.slices.map(slice => slice.id), reason));
      sample[field.key] = next;
    }
  }
  return { sample, voidedConfirmations: [...new Set(voided)] };
}

// 染色方法更正：原确认作废，按新值重判
export function correctSliceMethod(db, sampleId, sliceId, methodRaw) {
  const sample = db.samples.find(item => item.id === sampleId);
  if (!sample) throw ruleError("sample_not_found", "样本不存在");
  const slice = sample.slices.find(item => item.id === sliceId);
  if (!slice) throw ruleError("slice_not_found", "切片不存在");
  const method = requireText(methodRaw, "染色方法");
  let voidedConfirmations = [];
  if (method !== slice.method) {
    const reason = `薄片 ${slice.id} 染色方法由「${slice.method}」更正为「${method}」，原确认作废，按新值重判`;
    voidedConfirmations = voidTicketsUsingSlices(db, [slice.id], reason);
    slice.method = method;
  }
  return { sample, slice, voidedConfirmations };
}
