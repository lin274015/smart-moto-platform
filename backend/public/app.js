const currency = new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0
});

const state = {
  records: [],
  quote: null,
  recordFilter: "",
  selectedRecordId: null
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });

  if (!response.ok) {
    throw new Error(`API ${response.status}: ${await response.text()}`);
  }

  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("json") ? response.json() : response.text();
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function setView(viewId) {
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === viewId);
  });
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === viewId);
  });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function recordSummary(record) {
  const repairs = (record.repairItems || []).filter(Boolean).join("、");
  return repairs || record.recommendations || "未填";
}

function renderRecordDetail(record) {
  const detail = document.querySelector("#recordDetail");
  if (!record) {
    detail.innerHTML = `<p class="muted">請輸入車牌查詢，或從左側列表選擇一筆維修紀錄。</p>`;
    return;
  }

  const inspectionResults = (record.inspectionResults || [])
    .slice(0, 30)
    .map(
      (item) =>
        `<span class="tag">${escapeHtml(item.item)} ${escapeHtml(item.status)}${item.note ? ` · ${escapeHtml(item.note)}` : ""}</span>`
    )
    .join("");

  detail.innerHTML = `
    <div class="detail-row"><span>車牌</span><strong>${escapeHtml(record.plate || "未填")}</strong></div>
    <div class="detail-row"><span>車主</span><strong>${escapeHtml(record.owner || "未填")}</strong></div>
    <div class="detail-row"><span>日期</span><strong>${escapeHtml(record.date || "未填")}</strong></div>
    <div class="detail-row"><span>公里數</span><strong>${escapeHtml(record.mileage || 0)} km</strong></div>
    <div class="detail-row"><span>廠牌型式</span><strong>${escapeHtml(record.model || "未填")}</strong></div>
    <div class="detail-row"><span>維修項目</span><div>${escapeHtml(recordSummary(record))}</div></div>
    <div class="detail-row"><span>檢查結果</span><div class="tag-list">${inspectionResults || `<span class="muted">此筆沒有填寫檢查結果代碼。</span>`}</div></div>
    <div class="detail-row"><span>備註</span><div>${escapeHtml(record.recommendations || "無")}</div></div>
    <div class="detail-row"><span>來源檔案</span><div>${escapeHtml(record.source || "")}</div></div>
  `;
}

function renderRecords() {
  document.querySelector("#recordCount").textContent = state.records.length;
  const latest = state.records[0];
  if (latest) {
    document.querySelector("#latestMileage").textContent = latest.mileage || 0;
    document.querySelector("#latestSample").textContent = `${latest.plate || "未填車牌"} / ${latest.owner || "未填車主"} / ${latest.date || "未填日期"}`;
  }
  const list = document.querySelector("#recordList");
  const visibleRecords = state.records.slice(0, 120);
  const moreCount = Math.max(state.records.length - visibleRecords.length, 0);
  const summary = document.querySelector("#recordSearchSummary");
  const activeRecord = state.records.find((record) => record.id === state.selectedRecordId) || state.records[0];

  if (summary) {
    summary.textContent = state.recordFilter
      ? `車牌包含「${state.recordFilter}」的歷史紀錄共 ${state.records.length} 筆。`
      : `顯示最近 ${Math.min(visibleRecords.length, state.records.length)} 筆維修紀錄；可輸入車牌查詢完整歷史。`;
  }

  list.innerHTML = visibleRecords
    .map(
      (record) => `
        <button class="record-item ${record.id === activeRecord?.id ? "active" : ""}" type="button" data-record-id="${escapeHtml(record.id)}">
          <strong>${escapeHtml(record.plate || "未填車牌")} · ${escapeHtml(record.owner || "未填車主")}</strong>
          <span>${escapeHtml(record.date || "未填日期")} · ${escapeHtml(record.mileage || 0)} km · ${escapeHtml(record.model || "")}</span>
          <span>維修項目：${escapeHtml(recordSummary(record))}</span>
        </button>
      `
    )
    .join("") + (moreCount ? `<p class="muted">另有 ${moreCount} 筆資料已匯入，可透過後端 API 查詢或後續加上搜尋篩選。</p>` : "");

  renderRecordDetail(activeRecord);
}

function renderQuote(result) {
  state.quote = result;
  document.querySelector("#quoteTotal").textContent = currency.format(result.totals.grandTotal || 0);
  const feeLines = result.otherFees?.length
    ? result.otherFees
        .map(
          (fee) => `
        <div class="quote-line">
          <div>
            <strong>${fee.name}</strong>
            <span>數量 ${fee.quantity} · 單價 ${currency.format(fee.unitPrice)}${fee.note ? ` · ${fee.note}` : ""}</span>
          </div>
          <strong>${currency.format(fee.total)}</strong>
        </div>
      `
        )
        .join("")
    : `<div class="quote-line"><div>維修工資 / 其他費用</div><strong>${currency.format(0)}</strong></div>`;

  document.querySelector("#quoteResult").innerHTML = `
    ${result.parts
      .map(
        (part) => `
        <div class="quote-line">
          <div>
            <strong>${part.partNo} ${part.name}</strong>
            <span>數量 ${part.quantity} · 牌價 ${currency.format(part.listPrice)} · 報價 ${currency.format(part.quotePrice)}</span>
          </div>
          <strong>${currency.format(part.total)}</strong>
        </div>
      `
      )
      .join("")}
    <div class="quote-line">
      <div>材料費用小計</div>
      <strong>${currency.format(result.totals.materialTotal)}</strong>
    </div>
    ${feeLines}
    <div class="quote-line">
      <div>預估材料毛利</div>
      <strong>${currency.format(result.totals.grossProfitTotal)}</strong>
    </div>
    <div class="quote-line">
      <div>工資與服務費小計</div>
      <strong>${currency.format(result.totals.otherFeeTotal)}</strong>
    </div>
    <div class="total-line">
      <div>維修事件總金額</div>
      <strong>${currency.format(result.totals.repairEventTotal || result.totals.grandTotal)}</strong>
    </div>
  `;
}

function appendMessage(role, text) {
  const wrap = document.querySelector("#chatMessages");
  const node = document.createElement("div");
  node.className = `message ${role}`;
  node.textContent = text;
  wrap.append(node);
  wrap.scrollTop = wrap.scrollHeight;
}

function previewText(text, maxLength = 420) {
  const clean = String(text || "").trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, maxLength)}\n\n...內容較長，請按下方按鈕查看完整內容。`;
}

function setAiOutput(output, text, meta = "") {
  const fullText = `${text || ""}${meta || ""}`;
  output.dataset.fullText = fullText;
  output.textContent = previewText(fullText);

  const openButton = document.querySelector(`[data-output="${output.id}"]`);
  if (openButton) {
    openButton.hidden = !fullText.trim();
  }
}

function openResultModal(title, text) {
  document.querySelector("#resultModalTitle").textContent = title || "完整內容";
  document.querySelector("#resultModalBody").textContent = text || "";
  document.querySelector("#resultModal").hidden = false;
}

function closeResultModal() {
  document.querySelector("#resultModal").hidden = true;
}

async function loadRecords(plate = "") {
  const query = plate ? `?plate=${encodeURIComponent(plate)}` : "";
  state.records = await api(`/api/records${query}`);
  state.recordFilter = plate;
  state.selectedRecordId = state.records[0]?.id || null;
  renderRecords();
}

async function loadInitialData() {
  const [records, template] = await Promise.all([api("/api/records"), api("/api/quote-template")]);
  state.records = records;
  state.selectedRecordId = state.records[0]?.id || null;
  renderRecords();
  renderQuote(template.example);
  appendMessage("ai", "你好，我是 MotoAI 維修助手。可以協助產生維修紀錄、保養建議、估價公式說明與訓練資料整理。");
}

function bindNavigation() {
  document.querySelectorAll(".nav-tab").forEach((button) => {
    button.addEventListener("click", () => setView(button.dataset.view));
  });
}

function bindRecordForm() {
  document.querySelector("#recordSearchForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const plate = new FormData(event.currentTarget).get("plate").trim();
    await loadRecords(plate);
  });

  document.querySelector("#clearRecordSearch").addEventListener("click", async () => {
    document.querySelector("#recordSearchForm").reset();
    await loadRecords("");
  });

  document.querySelector("#recordList").addEventListener("click", (event) => {
    const item = event.target.closest("[data-record-id]");
    if (!item) return;
    state.selectedRecordId = item.dataset.recordId;
    renderRecords();
  });

  document.querySelector("#recordForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formToObject(event.currentTarget);
    const record = await api("/api/records", {
      method: "POST",
      body: JSON.stringify({
        ...data,
        mileage: Number(data.mileage || 0),
        repairItems: data.repairItems
          .split(/\n|,|、/)
          .map((item) => item.trim())
          .filter(Boolean),
        recommendations: data.recommendations
      })
    });
    state.records.unshift(record);
    renderRecords();
  });
}

function bindQuoteForm() {
  document.querySelector("#quoteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = formToObject(event.currentTarget);
    const result = await api("/api/quotes/calculate", {
      method: "POST",
      body: JSON.stringify({
        vehicle: {
          plate: state.records[0]?.plate,
          owner: state.records[0]?.owner
        },
        parts: [
          {
            partNo: data.partNo,
            name: data.name,
            quantity: Number(data.quantity || 0),
            listPrice: Number(data.listPrice || 0),
            damage: data.damage
          }
        ],
        laborHours: Number(data.laborHours || 0),
        laborRate: Number(data.laborRate || 0),
        inspectionFee: Number(data.inspectionFee || 0),
        otherFee: Number(data.otherFee || 0),
        otherFees: []
      })
    });
    renderQuote(result);
  });
}

async function askAssistant(message) {
  appendMessage("user", message);
  const result = await api("/api/ai/chat", {
    method: "POST",
    body: JSON.stringify({ message })
  });
  const refs = result.references?.length
    ? `\n\n參考：${result.references.map((item) => item.title).join("、")}`
    : "";
  const providerNote = result.provider === "gemini" ? "\n\n來源：Gemini 2.5 Flash + RAG" : result.error ? `\n\n備註：${result.error}` : "";
  appendMessage("ai", `${result.answer}${refs}${providerNote}`);
}

function bindAssistant() {
  document.querySelector("#chatForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = new FormData(form).get("message").trim();
    if (!message) return;
    form.reset();
    await askAssistant(message);
  });

  document.querySelectorAll("[data-prompt]").forEach((button) => {
    button.addEventListener("click", () => askAssistant(button.dataset.prompt));
  });
}

function bindAiTools() {
  document.querySelectorAll("[data-close-modal]").forEach((button) => {
    button.addEventListener("click", closeResultModal);
  });

  document.querySelectorAll(".result-open").forEach((button) => {
    button.addEventListener("click", () => {
      const output = document.querySelector(`#${button.dataset.output}`);
      openResultModal(button.dataset.title, output?.dataset.fullText || output?.textContent || "");
    });
  });

  document.querySelector("#reportForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const output = document.querySelector("#reportOutput");
    output.textContent = "生成中...";
    const result = await api("/api/ai/generate-report", {
      method: "POST",
      body: JSON.stringify(formToObject(event.currentTarget))
    });
    setAiOutput(output, result.report, result.provider === "gemini" ? "\n\n來源：Gemini 2.5 Flash + RAG" : `\n\n備註：${result.error}`);
  });

  document.querySelector("#diagnosisForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const output = document.querySelector("#diagnosisOutput");
    output.textContent = "分析中...";
    const result = await api("/api/ai/diagnosis", {
      method: "POST",
      body: JSON.stringify(formToObject(event.currentTarget))
    });
    setAiOutput(output, result.diagnosis, result.provider === "gemini" ? "\n\n來源：Gemini 2.5 Flash + RAG" : `\n\n備註：${result.error}`);
  });

  document.querySelector("#maintenanceForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const output = document.querySelector("#maintenanceOutput");
    output.textContent = "產生中...";
    const result = await api("/api/ai/maintenance-advice", {
      method: "POST",
      body: JSON.stringify(formToObject(event.currentTarget))
    });
    setAiOutput(output, result.advice, result.provider === "gemini" ? "\n\n來源：Gemini 2.5 Flash + RAG" : `\n\n備註：${result.error}`);
  });
}

function bindTraining() {
  document.querySelector("#trainingForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = formToObject(event.currentTarget);
    const result = await api("/api/ai/train", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    document.querySelector("#trainingStatus").textContent = `已加入 ${result.added} 筆樣本；目前共 ${result.total} 筆自訂訓練資料。`;
  });

  document.querySelector("#exportTraining").addEventListener("click", async () => {
    const jsonl = await api("/api/ai/training-set.jsonl");
    const blob = new Blob([jsonl], { type: "application/jsonl;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "motoai-training-set.jsonl";
    link.click();
    URL.revokeObjectURL(url);
  });
}

bindNavigation();
bindRecordForm();
bindQuoteForm();
bindAssistant();
bindAiTools();
bindTraining();
loadInitialData().catch((error) => {
  console.error(error);
  appendMessage("ai", `啟動資料載入失敗：${error.message}`);
});
