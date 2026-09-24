# 岩芯样本切片实验室

运行：

```bash
npm start
```

访问`http://localhost:3025`。支持样本创建、切片任务、步骤记录和交付统计。

## 开机首件确认

切片室更换砂轮后，首批薄片可能带烧边或划痕，因此换件后先建首件待确认单，确认通过前同一砂轮不接第二张。流程要点：

- 换件后建待确认单，记录砂轮批号、冷却水流量、磨盘转速和操作人；同一砂轮存在未结束的确认单时不能重复建单。
- 首件检查厚度（标准 0.03mm，合格区间 0.028–0.032mm）、划痕、边缘烧灼。
- 任一越界转复磨；复磨必须换人；连续两片达标才解除确认、恢复正常研磨接单。
- 样本钻孔、岩芯箱或染色方法更正后，关联的进行中确认单一律作废，沿用同一砂轮参数按新值重判。

代码按职责拆在三个业务文件：

| 文件 | 职责 |
| --- | --- |
| `business/firstPieceRules.js` | 确认规则：建单校验、首件/复磨判定、换人、连续两片解除、研磨接单拦截、更正作废重判 |
| `business/firstPieceRecords.js` | 记录保存：确认单读写 `data/first-piece-orders.json`，已解除/作废单据全程留痕 |
| `business/firstPiecePage.js` | 页面操作：首件确认面板结构、样式与前端交互 |

相关接口：

- `GET /api/first-piece/orders`、`POST /api/first-piece/orders`
- `POST /api/first-piece/orders/:id/inspections`（首件检查）
- `POST /api/first-piece/orders/:id/regrinds`（复磨结果）
- `PATCH /api/samples/:id/correction`（样本信息更正并重判）

确认未解除时，切片记录「研磨」步骤会被拒绝（错误码 `first_piece_pending`）。
