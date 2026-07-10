import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";

import dotenv from "dotenv";
import { askGemini } from "./services/gemini.js";

dotenv.config();
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const DB_PATH = path.join(__dirname, "data", "db.json");
const ASSISTANT_CONFIG_PATH = path.join(__dirname, "data", "assistant.config.json");
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png"
};

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function saveDb(db) {
  await writeFile(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data, null, 2));
}

function sendText(response, text, status = 200, contentType = "text/plain; charset=utf-8") {
  response.writeHead(status, { "Content-Type": contentType });
  response.end(text);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function safeStaticPath(urlPath) {
  const pathname = decodeURIComponent(urlPath.split("?")[0]);
  const requested = pathname === "/" ? "/index.html" : pathname;
  const fullPath = path.normalize(path.join(PUBLIC_DIR, requested));
  return fullPath.startsWith(PUBLIC_DIR) ? fullPath : null;
}



import { calculateQuote } from "./src/services/quote.service.js";
function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .trim();
}

function scoreKnowledge(query, item) {
  const normalizedQuery = normalize(query);
  const haystack = normalize(`${item.title} ${item.content}`);
  if (!normalizedQuery) return 0;

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  let score = 0;
  for (const term of terms) {
    if (haystack.includes(term)) score += term.length > 1 ? 2 : 1;
  }

  const keyTerms = ["維修", "保養", "估價", "報價", "毛利", "車牌", "公里", "AI", "故障", "檢查"];
  for (const term of keyTerms) {
    if (query.includes(term) && `${item.title}${item.content}`.includes(term)) score += 3;
  }
  return score;
}

function retrieveKnowledge(query, db, config) {
  const customKnowledge = (db.trainingExamples || []).map((item, index) => ({
    id: `trained-${index + 1}`,
    title: item.intent || "訓練樣本",
    content: `${item.input}\n${item.output}`
  }));
  const pool = [...db.knowledge, ...customKnowledge];
  return pool
    .map((item) => ({ ...item, score: scoreKnowledge(query, item) }))
    .filter((item) => item.score >= config.retrieval.minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, config.retrieval.topK);
}

function queryTokens(text) {
  const normalizedTerms = normalize(text).split(/\s+/).filter((term) => term.length >= 2);
  const domainTerms = [
    "煞車",
    "剎車",
    "異音",
    "火星塞",
    "電瓶",
    "空濾",
    "傳動",
    "機油",
    "皮帶",
    "普利",
    "輪胎",
    "大保養",
    "啟動",
    "難發",
    "冷車",
    "頭燈",
    "喇叭",
    "漏油",
    "抖動",
    "JET",
    "MANY",
    "VJR"
  ];
  const upperText = String(text || "").toUpperCase();
  const matchedDomainTerms = domainTerms.filter((term) => upperText.includes(term.toUpperCase()));
  return [...new Set([...normalizedTerms, ...matchedDomainTerms])];
}

function recordText(record) {
  return [
    record.plate,
    record.owner,
    record.model,
    record.date,
    record.mileage,
    (record.inspectionItems || []).join(" "),
    (record.inspectionResults || []).map((item) => `${item.item} ${item.status} ${item.note}`).join(" "),
    (record.repairItems || []).join(" "),
    record.recommendations,
    record.source
  ]
    .filter(Boolean)
    .join(" ");
}

function getPlateFromText(text) {
  const match = String(text || "").toUpperCase().match(/[A-Z]{2,4}-?\d{3,4}/);
  if (!match) return "";
  const value = match[0];
  return value.includes("-") ? value : value.replace(/^([A-Z]+)(\d+)$/, "$1-$2");
}

function getVehicleRecordsByPlate(plate, db) {
  const normalizedPlate = normalize(plate).replace(/\s/g, "");
  if (!normalizedPlate) return [];

  return db.records
    .filter((record) => normalize(record.plate).replace(/\s/g, "") === normalizedPlate)
    .sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
}

function hasMajorMaintenanceSignal(record) {
  const text = `${(record.repairItems || []).join(" ")} ${record.recommendations || ""}`;
  return /大保養|皮帶|普利珠|火星塞|空濾|離合器|碗公|油封/.test(text);
}

function getMajorMaintenanceMilestone(plate, db) {
  const records = getVehicleRecordsByPlate(plate, db).slice().sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
  const firstMajorIndex = records.findIndex(hasMajorMaintenanceSignal);

  if (firstMajorIndex < 0) return null;

  const firstMajor = records[firstMajorIndex];
  const previous = records[firstMajorIndex - 1] || null;
  const laterRepeatedCount = records
    .slice(firstMajorIndex + 1)
    .filter((record) => record.recommendations && firstMajor.recommendations && record.recommendations === firstMajor.recommendations).length;

  return { firstMajor, previous, laterRepeatedCount };
}

function formatMaintenanceMilestone(milestone) {
  if (!milestone) return "未找到明確的大保養或大型保養備註起點。";

  return `
【大保養判斷線索】
大保養/大型保養備註第一次出現日期：${milestone.firstMajor.date || "未填"}
該筆里程：${milestone.firstMajor.mileage || "未填"} km
前一筆紀錄日期：${milestone.previous?.date || "無"}
前一筆里程：${milestone.previous?.mileage || "無"} km
判斷規則：若後續紀錄重複出現相同備註，應視為延續備註或待辦清單，不可直接判定為後續日期才做大保養。
重複延續備註筆數：${milestone.laterRepeatedCount}
首次大保養相關內容：${milestone.firstMajor.recommendations || (milestone.firstMajor.repairItems || []).join("、") || "未填"}
`;
}

function getRelevantRecords(question, db, limit = 5) {
  const tokens = queryTokens(question);
  const plate = getPlateFromText(question);
  const vehicleRecords = getVehicleRecordsByPlate(plate, db);

  if (vehicleRecords.length && /保養|大保養|歷史|紀錄|建議/.test(question)) {
    const milestone = getMajorMaintenanceMilestone(plate, db);
    const pinnedRecords = [milestone?.firstMajor, milestone?.previous, ...vehicleRecords.slice(0, 4)].filter(Boolean);
    return [...new Map(pinnedRecords.map((record) => [record.id, record])).values()].slice(0, limit);
  }

  if (!tokens.length) return [];

  return db.records
    .map((record) => {
      const sourceText = recordText(record);
      const normalizedText = normalize(sourceText).replace(/\s/g, "");
      const upperText = sourceText.toUpperCase();
      let score = 0;

      for (const token of tokens) {
        const normalizedToken = normalize(token).replace(/\s/g, "");
        if (normalizedToken && normalizedText.includes(normalizedToken)) score += normalizedToken.length + 2;
        if (upperText.includes(token.toUpperCase())) score += token.length + 2;
      }

      if (record.plate && String(question).toUpperCase().includes(record.plate.toUpperCase())) score += 20;
      return { record, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {

  if (b.score !== a.score) {
    return b.score - a.score;
  }

  const dateA = new Date(a.record.date || 0);
  const dateB = new Date(b.record.date || 0);

  return dateB - dateA;
})
.slice(0, limit)
.map((item) => item.record);
}

function getLatestVehicleRecord(plate, db) {

  if (!plate) return null;

  return db.records
    .filter(
      (record) =>
        String(record.plate || "").toUpperCase() ===
        String(plate).toUpperCase()
    )
    .sort(
      (a, b) =>
        new Date(b.date || 0) -
        new Date(a.date || 0)
    )[0] || null;
}

function formatRecordsContext(records) {

  if (!records.length) {
    return "目前沒有找到相關維修紀錄。";
  }

  const uniqueRecords =
    [...new Map(
      records.map(record => [
        `${record.plate}-${record.date}-${record.mileage}`,
        record
      ])
    ).values()];

  return uniqueRecords
    .map(
      (record, index) => `
【歷史紀錄 ${index + 1}】

車牌：${record.plate || "未填"}

車型：${record.model || "未填"}

日期：${record.date || "未填"}

里程：${record.mileage || "未填"} km

維修項目：
${(record.repairItems || []).join("、") || "未填"}

備註：
${record.recommendations || "無"}
`
    )
    .join("\n");
}

async function askGeminiWithFallback(prompt, fallback) {

  try {

    let answer = await askGemini(prompt);

    if (answer) {
      answer = answer
        .replace(/\*\*/g, "")
        .replace(/\*/g, "")
        .replace(/#{1,6}/g, "")
        .replace(/^\s*[-•]\s*/gm, "")
        .trim();
    }

    return {
      answer: answer || fallback,
      provider: answer ? "gemini" : "local-fallback",
      model: "gemini-2.5-flash",
      error: answer ? "" : "Gemini 沒有回傳文字"
    };

  } catch (error) {

    return {
      answer: fallback,
      provider: "local-fallback",
      model: "gemini-2.5-flash",
      error: `Gemini 呼叫失敗：${error.message}`
    };

  }

}

function buildMaintenanceDraft(payload, db) {
  const record = payload.recordId
    ? db.records.find((item) => item.id === payload.recordId)
    : null;
  const base = record || payload;
  const plate = base.plate || payload.plate || "未填車牌";
  const mileage = base.mileage || payload.mileage || "未填";
  const repairItems = base.repairItems?.length ? base.repairItems.join("、") : payload.problem || "一般檢查與保養";

  return [
    `車牌 ${plate} 本次進廠里程為 ${mileage} 公里，維修項目為 ${repairItems}。`,
    "建議依標準檢查項目確認前後輪、煞車系統、空濾、傳動組、燈具、喇叭、電瓶與火星塞狀態。",
    "若檢查代碼出現 W，應列入下次保養或報價追蹤；若為 C，需於維修紀錄註明已更換零件與數量。",
    "可向客戶說明本次處理內容、後續觀察項目與下次建議回廠時機。"
  ].join("\n");
}

function buildMaintenanceAdviceFallback(payload, db) {
  const plate = payload.plate || getPlateFromText(payload.description || payload.problem || "");
  const latestRecord = getLatestVehicleRecord(plate, db);
  const milestone = plate ? getMajorMaintenanceMilestone(plate, db) : null;

  if (!milestone) {
    return buildMaintenanceDraft(payload, db);
  }

  return [
    `車牌 ${plate} 的大保養線索不是最新一筆紀錄，而是 ${milestone.firstMajor.date} 這筆開始出現大保養與零件清單；前一筆 ${milestone.previous?.date || "無"} 尚未出現相同內容。`,
    `因此應判斷大保養相關內容落在 ${milestone.previous?.date || "前一筆"} 到 ${milestone.firstMajor.date} 之間，而不是 ${latestRecord?.date || "最新紀錄"}。`,
    `最新紀錄可作為目前狀態參考：${latestRecord?.date || "無"}，里程 ${latestRecord?.mileage || "無"} km，維修項目為 ${latestRecord?.repairItems?.join("、") || "無"}。`,
    "後續建議：依目前里程安排機油/齒輪油週期保養，並檢查空濾、火星塞、傳動、輪胎與煞車；若後續紀錄只是重複同一串備註，請不要把它當成新的大保養日期。"
  ].join("\n");
}

function localAssistantAnswer(message, db, config) {
  const hits = retrieveKnowledge(message, db, config);
  const latestRecord = db.records[0];
  const plate = getPlateFromText(message);

  if (plate && /保養|大保養|維修紀錄|歷史/.test(message)) {
    return {
      answer: buildMaintenanceAdviceFallback({ plate, description: message }, db),
      references: hits
    };
  }

  if (/估價|報價|費用|金額|毛利/.test(message)) {
    return {
      answer:
        "估價單可依來源公式計算：報價 = 牌價 * 1.15，材料總價 = 數量 * 報價，毛利 = (報價 - 牌價 * 0.85) * 數量；其他費用則以數量 * 單價計算，最後合計材料費用與其他費用。",
      references: hits
    };
  }

  if (/保養|建議|檢查|故障/.test(message)) {
    return {
      answer: buildMaintenanceDraft({ recordId: latestRecord?.id }, db),
      references: hits
    };
  }

  if (/訓練|知識庫|RAG|rag/i.test(message)) {
    return {
      answer:
        "目前助手採用知識庫/RAG 訓練流程：先把計畫書、維修單欄位、估價單公式與新增樣本整理成知識片段，再依問題擷取最相關內容產生回答。若要做真正模型微調，可使用本系統的 JSONL 匯出資料作為後續 fine-tuning 資料集。",
      references: hits
    };
  }

  const context = hits.map((item) => `「${item.title}」${item.content}`).join("\n");
  return {
    answer: context
      ? `根據目前知識庫，${context}`
      : "目前知識庫沒有足夠資料回答這題。請補充車型、維修項目、問題描述或估價明細，我可以協助整理成維修紀錄或報價說明。",
    references: hits
  };
}

function buildRagPrompt(question, db, config) {
  const records = getRelevantRecords(question, db, 5);
  const plate = getPlateFromText(question);
  const milestone = plate ? getMajorMaintenanceMilestone(plate, db) : null;
  const knowledge = retrieveKnowledge(question, db, config);
  const knowledgeContext = knowledge.map((item) => `【${item.title}】${item.content}`).join("\n");

  return {
    records,
    knowledge,
    prompt: `
你是智慧機車維修管理平台的 AI 助手，也是一位專業機車技師。

請使用繁體中文回答。不要使用：

*
**
#
-

請使用一般段落文字。
回答請精簡，預設控制在 500 字以內；若資料很多，先給摘要，再列關鍵日期。
請根據歷史維修紀錄與系統知識庫回答，不要捏造不存在的價格、車主資料或維修結果。
如果同一車牌有多筆維修紀錄，不可只看最新日期；要比較前後紀錄內容差異。
若某段「大保養/零件清單」在多個後續日期重複出現，請把第一次出現該內容的日期視為大保養線索，後續日期只可說是延續備註，不能說後續日期做了大保養。

如果資料不足，
請先說明缺少哪些欄位，
再提出可執行的檢查方向。
【系統知識庫】
${knowledgeContext || "無"}

【歷史維修紀錄 RAG】
${formatRecordsContext(records)}

${formatMaintenanceMilestone(milestone)}

【使用者問題】
${question}
`
  };
}

async function answerChatWithGemini(message, db, config) {

  const rag = buildRagPrompt(
    message,
    db,
    config
  );

  const fallback =
    localAssistantAnswer(
      message,
      db,
      config
    );

  const result =
    await askGeminiWithFallback(
      rag.prompt,
      fallback.answer
    );

  // 去除重複維修紀錄
  const uniqueRecords =
    [
      ...new Map(
        rag.records.map(record => [
          `${record.plate}-${record.date}-${record.mileage}`,
          record
        ])
      ).values()
    ];

  return {

    answer: result.answer,

    references: [

      ...fallback.references,

      ...uniqueRecords.map(
        (record) => ({
          id: record.id,

          title:
            `${record.plate || "未填車牌"} ${
              record.date || ""
            }`,

          content:
            `${record.model || ""} ${
              (record.repairItems || [])
                .join("、")
            }`
        })
      )

    ].slice(0, 8),

    provider: result.provider,
    model: result.model,
    error: result.error

  };

}
async function generateAiReport(payload, db) {
  const question = [payload.vehicle, payload.model, payload.problem, payload.parts].filter(Boolean).join(" ");
  const records = getRelevantRecords(question, db, 5);
  const fallback = [
    "問題描述：依輸入內容建立維修紀錄，需補充實際檢查結果。",
    "檢查結果：建議確認煞車、電瓶、火星塞、空濾、傳動與燈具等標準項目。",
    `維修內容：${payload.parts || payload.repairItems || "依檢查結果安排維修或更換零件。"}`,
    "後續建議：交車時向客戶說明已處理項目、需觀察項目與下次回廠時機。"
  ].join("\n");

  const prompt = `
你是機車行的 AI 維修報告助手。請使用繁體中文，依照「問題描述、檢查結果、維修內容、後續建議、客戶說明」五段輸出。

【車輛資料】
車型：${payload.vehicle || payload.model || "未填"}
車牌：${payload.plate || "未填"}
里程：${payload.mileage || "未填"} km
故障描述：${payload.problem || "未填"}
更換零件：${payload.parts || "未填"}

【可參考的歷史維修紀錄】
${formatRecordsContext(records)}
`;

  const result = await askGeminiWithFallback(prompt, fallback);
  return { report: result.answer, references: records, provider: result.provider, model: result.model, error: result.error };
}

async function generateDiagnosis(payload, db) {
  const symptom = payload.symptom || payload.problem || "";
  const question = [payload.plate, payload.vehicle, payload.model, payload.mileage, symptom].filter(Boolean).join(" ");
  const records = getRelevantRecords(question, db, 5);
  const fallback = [
    `症狀：${symptom || "未填"}`,
    "可能原因：電瓶狀態、火星塞、供油/進氣、傳動或煞車系統需依症狀確認。",
    "建議檢查：先做外觀與安全檢查，再依症狀檢查電系、油路、空濾、火星塞、煞車與傳動。",
    "處理優先度：若涉及煞車失效、輪胎、漏油或異常熄火，建議立即停用並進廠檢查。"
  ].join("\n");

  const prompt = `
你是專業機車故障診斷 AI。請根據症狀與歷史紀錄，輸出：
1. 可能原因
2. 建議檢查順序
3. 需立即處理的安全風險
4. 給客戶的白話說明

【症狀】
${symptom}

【車輛資料】
車牌：${payload.plate || "未填"}
車型：${payload.vehicle || payload.model || "未填"}
里程：${payload.mileage || "未填"} km

【歷史維修紀錄】
${formatRecordsContext(records)}
`;

  const result = await askGeminiWithFallback(prompt, fallback);
  return { diagnosis: result.answer, references: records, provider: result.provider, model: result.model, error: result.error };
}

async function generateMaintenanceAdvice(payload, db) {
  const latestRecord =
    getLatestVehicleRecord(
      payload.plate,
      db
    );

  const question = [payload.plate, payload.model, payload.vehicle, payload.mileage, payload.description].filter(Boolean).join(" ");
  const records = getRelevantRecords(question, db, 5);
  const milestone = payload.plate ? getMajorMaintenanceMilestone(payload.plate, db) : null;
  const fallback = buildMaintenanceAdviceFallback(payload, db);
  const prompt = `
你是機車保養建議 AI。

請根據：
1. 最近一次維修紀錄
2. 歷史維修紀錄
3. 目前車輛資訊

輸出：

1. 建議保養項目
2. 建議檢查項目
3. 可延後觀察項目
4. 下次回廠提醒

請精簡輸出，控制在 500 字以內。
重要：最近一次維修紀錄只代表目前狀態，不一定是大保養日期。
重要：若某段「大保養/零件清單」在後續紀錄重複出現，請以第一次出現該內容的日期作為大保養線索，並比較前一筆紀錄。

========================

【最近一次維修紀錄】

日期：
${latestRecord?.date || "無"}

里程：
${latestRecord?.mileage || "無"} km

維修項目：
${latestRecord?.repairItems?.join("、") || "無"}

========================

【歷史維修紀錄】

${formatRecordsContext(records)}

${formatMaintenanceMilestone(milestone)}

========================

【目前輸入資料】

車牌：
${payload.plate || "未填"}

車型：
${payload.model || payload.vehicle || "未填"}

里程：
${payload.mileage || "未填"} km

補充描述：
${payload.description || payload.problem || "無"}

請使用繁體中文回答。
不要使用 Markdown。
不要輸出 *、**、#。
`;

  const result = await askGeminiWithFallback(prompt, fallback);
  return { advice: result.answer, references: records, provider: result.provider, model: result.model, error: result.error };
}

function trainingJsonl(db) {
  const generated = [
    {
      messages: [
        { role: "system", content: "你是機車維修管理平台的 AI 助手，使用繁體中文回答。" },
        { role: "user", content: "請說明這個系統的主要功能。" },
        {
          role: "assistant",
          content:
            "系統主要功能包含維修紀錄管理、AI 維修紀錄生成、保養建議、故障描述分析、智慧客服問答與估價單計算。"
        }
      ]
    },
    {
      messages: [
        { role: "system", content: "你是機車維修管理平台的 AI 助手，計算估價時必須依公式。" },
        { role: "user", content: "牌價 1650、數量 1 的頭燈總成如何計價？" },
        {
          role: "assistant",
          content:
            "報價為 1650 * 1.15 = 1897.5，總價為 1 * 1897.5 = 1897.5，毛利為 (1897.5 - 1650 * 0.85) * 1 = 495。"
        }
      ]
    }
  ];

  const custom = (db.trainingExamples || []).map((item) => ({
    messages: [
      { role: "system", content: "你是機車維修管理平台的 AI 助手，使用繁體中文回答。" },
      { role: "user", content: item.input },
      { role: "assistant", content: item.output }
    ]
  }));

  return [...generated, ...custom].map((item) => JSON.stringify(item)).join("\n");
}

async function handleApi(request, response, url) {
  const db = await loadJson(DB_PATH);
  const config = await loadJson(ASSISTANT_CONFIG_PATH);

  if (request.method === "GET" && url.pathname === "/api/test-gemini") {
    const result = await askGeminiWithFallback("請用繁體中文回答：Gemini 測試成功", "Gemini 測試備援回答：後端路由正常。");
    return sendJson(response, result);
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, { ok: true, app: "smart-moto-ai-platform" });
  }

  if (request.method === "GET" && url.pathname === "/api/records") {
    const plate = normalize(url.searchParams.get("plate") || "").replace(/\s/g, "");
    const limit = Number(url.searchParams.get("limit") || 0);
    let records = db.records;

    if (plate) {

  records = records
    .filter((record) =>
      normalize(record.plate)
        .replace(/\s/g, "")
        .includes(plate)
    )
    .sort(
      (a,b)=>
        new Date(b.date || 0)
        - new Date(a.date || 0)
    );

}

    if (limit > 0) {
      records = records.slice(0, limit);
    }

    return sendJson(response, records);
  }

  if (request.method === "POST" && url.pathname === "/api/records") {
    const payload = await readBody(request);
    const record = {
      id: `R-${Date.now()}`,
      date: new Date().toISOString().slice(0, 10),
      inspectionItems: db.records[0]?.inspectionItems || [],
      repairItems: [],
      ...payload
    };
    db.records.unshift(record);
    await saveDb(db);
    return sendJson(response, record, 201);
  }

  if (request.method === "GET" && url.pathname === "/api/quote-template") {
    return sendJson(response, {
      columns: ["料號", "材料名稱", "數量", "牌價", "報價", "總價", "毛利", "損壞狀況"],
      formulas: {
        quotePrice: "listPrice * 1.15",
        total: "quantity * quotePrice",
        grossProfit: "(quotePrice - listPrice * 0.85) * quantity"
      },
      example: calculateQuote(db.quotes[0])
    });
  }

  if (request.method === "POST" && url.pathname === "/api/quotes/calculate") {
    const payload = await readBody(request);
    return sendJson(response, calculateQuote(payload));
  }

  if (request.method === "POST" && url.pathname === "/api/ai/generate-maintenance") {
    const payload = await readBody(request);
    const result = await generateMaintenanceAdvice(payload, db);
    return sendJson(response, { draft: result.advice, ...result });
  }

  if (request.method === "POST" && url.pathname === "/api/ai/chat") {
    const payload = await readBody(request);
    return sendJson(response, await answerChatWithGemini(payload.message || "", db, config));
  }

  if (request.method === "POST" && url.pathname === "/api/ai/generate-report") {
    const payload = await readBody(request);
    return sendJson(response, await generateAiReport(payload, db));
  }

  if (request.method === "POST" && url.pathname === "/api/ai/diagnosis") {
    const payload = await readBody(request);
    return sendJson(response, await generateDiagnosis(payload, db));
  }

  if (request.method === "POST" && url.pathname === "/api/ai/maintenance-advice") {
    const payload = await readBody(request);
    return sendJson(response, await generateMaintenanceAdvice(payload, db));
  }

  if (request.method === "POST" && url.pathname === "/api/ai/train") {
    const payload = await readBody(request);
    const examples = Array.isArray(payload.examples) ? payload.examples : [payload];
    const clean = examples
      .filter((item) => item.input && item.output)
      .map((item) => ({
        intent: item.intent || "自訂訓練樣本",
        input: String(item.input),
        output: String(item.output),
        createdAt: new Date().toISOString()
      }));
    db.trainingExamples.push(...clean);
    await saveDb(db);
    return sendJson(response, { added: clean.length, total: db.trainingExamples.length });
  }

  if (request.method === "GET" && url.pathname === "/api/ai/training-set.jsonl") {
    return sendText(response, trainingJsonl(db), 200, "application/jsonl; charset=utf-8");
  }

  return sendJson(response, { error: "API route not found" }, 404);
}

async function handleStatic(response, urlPath) {
  const fullPath = safeStaticPath(urlPath);
  if (!fullPath || !existsSync(fullPath)) {
    return sendText(response, "Not found", 404);
  }

  const extension = path.extname(fullPath);
  response.writeHead(200, { "Content-Type": MIME_TYPES[extension] || "application/octet-stream" });
  response.end(await readFile(fullPath));
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
    } else {
      await handleStatic(response, url.pathname);
    }
  } catch (error) {
    sendJson(response, { error: error.message }, 500);
  }
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.log(`Port ${PORT} is already in use. The app is probably already running at http://localhost:${PORT}`);
    process.exit(0);
  }
  throw error;
});

server.listen(PORT, () => {
  console.log(`Smart Moto AI Platform running at http://localhost:${PORT}`);
});
