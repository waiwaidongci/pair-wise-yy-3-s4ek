// 记录保存 —— 样本与砂轮首件确认的持久化（读写 JSON、建库与结构迁移）
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = join(__dirname, "data", "core-slices.json");

const seed = {
  samples: [
    {
      id: "CORE-001",
      project: "东岭铜矿薄片",
      borehole: "ZK-17",
      coreBox: "BX-09",
      depth: "128.4-128.8m",
      owner: "陆川",
      status: "制片中",
      delivery: "未交付",
      slices: [
        {
          id: "SL-001-A",
          method: "茜素红染色",
          observation: "",
          status: "研磨",
          logs: [
            { at: "2026-06-12T10:00:00.000Z", step: "取样", note: "截取含矿化条带位置" },
            { at: "2026-06-13T11:20:00.000Z", step: "切割", note: "完成粗切" }
          ]
        }
      ]
    }
  ],
  confirmations: []
};

// 补齐历史库缺失的字段：早期只有 samples，没有 confirmations
function migrate(db) {
  if (!Array.isArray(db.samples)) db.samples = [];
  if (!Array.isArray(db.confirmations)) db.confirmations = [];
  return db;
}

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dirname(dbPath), { recursive: true });
    await writeFile(dbPath, JSON.stringify(seed, null, 2));
    return JSON.parse(JSON.stringify(seed));
  }
  return migrate(JSON.parse(await readFile(dbPath, "utf8")));
}

export async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}
