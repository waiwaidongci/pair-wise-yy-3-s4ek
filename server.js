import http from "node:http";
import { loadDb, saveDb } from "./record-store.js";
import { page } from "./page.js";
import {
  THICKNESS_MIN_MM,
  THICKNESS_MAX_MM,
  REQUIRED_CONSECUTIVE_PASS,
  TICKET_PENDING,
  TICKET_RELEASED,
  TICKET_VOID,
  PIECE_OK,
  PIECE_REGRIND,
  createConfirmation,
  inspectFirstPiece,
  regrindPiece,
  releaseConfirmation,
  correctSample,
  correctSliceMethod
} from "./confirm-rules.js";

const port = Number(process.env.PORT || 3025);
const statuses = ["待切割", "制片中", "待观察", "已交付"];
const taskSteps = ["取样", "切割", "研磨", "染色", "观察"];

// 前端只读的判定口径，避免页面里硬编码
const clientMeta = {
  min: THICKNESS_MIN_MM,
  max: THICKNESS_MAX_MM,
  required: REQUIRED_CONSECUTIVE_PASS,
  pending: TICKET_PENDING,
  released: TICKET_RELEASED,
  ticketVoid: TICKET_VOID,
  pieceOk: PIECE_OK,
  pieceRegrind: PIECE_REGRIND
};
const htmlPage = page
  .replace('"__STATUSES__"', JSON.stringify(statuses))
  .replace('"__STEPS__"', JSON.stringify(taskSteps))
  .replace('"__META__"', JSON.stringify(clientMeta));

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const error = new Error("请求体不是合法 JSON");
    error.code = "invalid_input";
    throw error;
  }
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}
const STATUS_BY_CODE = {
  invalid_input: 400,
  wheel_pending: 409,
  ticket_not_pending: 409,
  not_releasable: 409,
  regrind_operator_same: 409,
  piece_not_regrind: 409,
  sample_not_found: 404,
  slice_not_found: 404,
  ticket_not_found: 404,
  piece_not_found: 404
};
function sendError(res, error) {
  const httpStatus = STATUS_BY_CODE[error.code] || 500;
  sendJson(res, httpStatus, { error: error.code || "internal_error", message: error.message });
}
function updateSampleStatus(sample) {
  const sliceStatuses = sample.slices.map(slice => slice.status);
  if (sliceStatuses.length && sliceStatuses.every(step => step === "观察")) sample.status = "待观察";
  if (sample.delivery === "已交付") sample.status = "已交付";
  else if (sliceStatuses.some(step => ["取样", "切割", "研磨", "染色"].includes(step))) sample.status = "制片中";
  else sample.status = "待切割";
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    const input = ["POST", "PATCH"].includes(req.method) ? await body(req) : {};

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(htmlPage);
    }

    // —— 样本与切片（原有流程）——
    if (req.method === "GET" && url.pathname === "/api/samples") return sendJson(res, 200, db.samples);
    if (req.method === "POST" && url.pathname === "/api/samples") {
      const sample = { id: `CORE-${Date.now()}`, project: input.project, borehole: input.borehole, coreBox: input.coreBox, depth: input.depth, owner: input.owner, status: "待切割", delivery: "未交付", slices: [{ id: input.sliceId, method: input.method, observation: "", status: "取样", logs: [{ at: new Date().toISOString(), step: "取样", note: "创建初始切片任务" }] }] };
      updateSampleStatus(sample);
      db.samples.unshift(sample);
      await saveDb(db);
      return sendJson(res, 201, sample);
    }

    const samplePatch = url.pathname.match(/^\/api\/samples\/([^/]+)$/);
    if (samplePatch && req.method === "PATCH") {
      try {
        const result = correctSample(db, samplePatch[1], input);
        await saveDb(db);
        return sendJson(res, 200, result);
      } catch (error) { return sendError(res, error); }
    }

    const addSlice = url.pathname.match(/^\/api\/samples\/([^/]+)\/slices$/);
    if (addSlice && req.method === "POST") {
      const sample = db.samples.find(item => item.id === addSlice[1]);
      if (!sample) return sendJson(res, 404, { error: "sample_not_found", message: "样本不存在" });
      sample.slices.push({ id: input.id, method: input.method || "未指定", observation: "", status: "取样", logs: [{ at: new Date().toISOString(), step: "取样", note: "新增切片任务" }] });
      updateSampleStatus(sample);
      await saveDb(db);
      return sendJson(res, 201, sample);
    }

    const methodFix = url.pathname.match(/^\/api\/samples\/([^/]+)\/slices\/([^/]+)\/method$/);
    if (methodFix && req.method === "PATCH") {
      try {
        const result = correctSliceMethod(db, methodFix[1], methodFix[2], input.method);
        await saveDb(db);
        return sendJson(res, 200, result);
      } catch (error) { return sendError(res, error); }
    }

    const logMatch = url.pathname.match(/^\/api\/samples\/([^/]+)\/slices\/([^/]+)\/logs$/);
    if (logMatch && req.method === "POST") {
      const sample = db.samples.find(item => item.id === logMatch[1]);
      if (!sample) return sendJson(res, 404, { error: "sample_not_found", message: "样本不存在" });
      const slice = sample.slices.find(item => item.id === logMatch[2]);
      if (!slice) return sendJson(res, 404, { error: "slice_not_found", message: "切片不存在" });
      slice.status = input.step;
      if (input.step === "观察") slice.observation = input.note || slice.observation;
      slice.logs.push({ at: new Date().toISOString(), step: input.step, note: input.note || "" });
      updateSampleStatus(sample);
      await saveDb(db);
      return sendJson(res, 200, sample);
    }

    const deliverMatch = url.pathname.match(/^\/api\/samples\/([^/]+)\/deliver$/);
    if (deliverMatch && req.method === "POST") {
      const sample = db.samples.find(item => item.id === deliverMatch[1]);
      if (!sample) return sendJson(res, 404, { error: "sample_not_found", message: "样本不存在" });
      sample.delivery = "已交付";
      updateSampleStatus(sample);
      await saveDb(db);
      return sendJson(res, 200, sample);
    }

    // —— 砂轮开机首件确认 ——
    if (req.method === "GET" && url.pathname === "/api/confirmations") return sendJson(res, 200, db.confirmations);
    if (req.method === "POST" && url.pathname === "/api/confirmations") {
      try {
        const ticket = createConfirmation(db, input);
        await saveDb(db);
        return sendJson(res, 201, ticket);
      } catch (error) { return sendError(res, error); }
    }

    const inspectMatch = url.pathname.match(/^\/api\/confirmations\/([^/]+)\/pieces$/);
    if (inspectMatch && req.method === "POST") {
      try {
        const result = inspectFirstPiece(db, inspectMatch[1], input);
        await saveDb(db);
        return sendJson(res, 201, result);
      } catch (error) { return sendError(res, error); }
    }

    const regrindMatch = url.pathname.match(/^\/api\/confirmations\/([^/]+)\/pieces\/([^/]+)\/regrind$/);
    if (regrindMatch && req.method === "POST") {
      try {
        const result = regrindPiece(db, regrindMatch[1], regrindMatch[2], input);
        await saveDb(db);
        return sendJson(res, 201, result);
      } catch (error) { return sendError(res, error); }
    }

    const releaseMatch = url.pathname.match(/^\/api\/confirmations\/([^/]+)\/release$/);
    if (releaseMatch && req.method === "POST") {
      try {
        const ticket = releaseConfirmation(db, releaseMatch[1]);
        await saveDb(db);
        return sendJson(res, 200, ticket);
      } catch (error) { return sendError(res, error); }
    }

    sendJson(res, 404, { error: "not_found", message: "接口不存在" });
  } catch (error) {
    sendError(res, error);
  }
});

server.listen(port, () => console.log(`Core slice lab app listening on http://localhost:${port}`));
