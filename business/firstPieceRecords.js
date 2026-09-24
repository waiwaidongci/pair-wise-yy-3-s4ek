// 开机首件确认 —— 记录保存
// 确认单独立存于 data/first-piece-orders.json。
// 规则判定在 ./firstPieceRules.js，本文件只负责落盘与读取；
// 已解除、已作废的确认单永久保留，不做覆盖删除。

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultPath = join(__dirname, "..", "data", "first-piece-orders.json");

export async function loadOrders(filePath = defaultPath) {
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf8");
  if (!raw.trim()) return [];
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed?.orders) ? parsed.orders : [];
}

export async function saveOrders(orders, filePath = defaultPath) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ orders }, null, 2));
}

// 以一次「读出-改写-落盘」完成单张确认单变更，避免并发覆盖。
// 变更函数返回的确认单若不在册则自动入册（建单场景）；
// 作废重开等多单变更由规则函数直接改写 orders 并返回摘要。
export async function withOrders(mutate, filePath = defaultPath) {
  const orders = await loadOrders(filePath);
  const result = await mutate(orders);
  if (result && typeof result === "object" && !Array.isArray(result) && result.id && !orders.includes(result)) {
    orders.push(result);
  }
  await saveOrders(orders, filePath);
  return { orders, result };
}
