# 智慧機車維修管理平台

這是一個根據期末專案計畫書、維修紀錄與估價單模板建立的本機 full-stack 原型。

## 啟動方式

### 用 VS Code 啟動

1. 在 VS Code 開啟此資料夾：

```text
C:\Users\ASUS\Documents\Codex\2026-06-01\files-mentioned-by-the-user-docx\outputs\smart-moto-ai-platform
```

2. 按 `F5`，選擇 `啟動 MotoAI 平台`。
3. 開啟瀏覽器：

```text
http://localhost:4173
```

也可以在 VS Code 使用 `Terminal > Run Task... > 啟動 MotoAI 伺服器`。

如果看到 `EADDRINUSE: address already in use :::4173`，代表平台已經在背景或另一個 VS Code 終端機跑起來了，不是壞掉。直接打開 `http://localhost:4173` 使用即可。新版啟動腳本會自動偵測這種情況並正常結束。

### 用終端機啟動

```powershell
cd C:\Users\ASUS\Documents\Codex\2026-06-01\files-mentioned-by-the-user-docx\outputs\smart-moto-ai-platform
node server.js
```

開啟：

```text
http://localhost:4173
```

## 已完成範圍

- 前端：總覽、維修紀錄、估價單、AI 助手、助手訓練頁面。
- 後端：原生 Node.js HTTP API，不需安裝套件。
- 資料：匯入 `2025-12-27.docx` 的維修紀錄欄位與 `估價單-空白含公式.xlsx` 的估價公式。
- 批次資料：已從 `E:\維修紀錄` 匯入 2014 筆維修紀錄。
- 維修查詢：管理者可在「維修紀錄」頁輸入車牌，查看該車歷史維修紀錄與明細。
- AI：Gemini 2.5 Flash + RAG，支援 AI 客服問答、維修報告生成、故障診斷、保養建議、新增訓練樣本與 JSONL 匯出。

## Gemini 設定

在專案根目錄建立 `.env`：

```text
GEMINI_API_KEY=你的 Gemini API Key
```

若沒有設定 API key，系統會自動使用本機備援回答，方便 Demo 時不中斷。

## 重新匯入維修資料夾

若 `E:\維修紀錄` 之後有新增 Word 維修單，可以在專案根目錄執行：

```powershell
python tools\import_repair_folder.py --source "E:\維修紀錄"
```

匯入器會略過 `標準空白頁.docx` 這類模板，並重建 `data\db.json` 裡的 `records`。

## API 摘要

- `GET /api/records`
- `GET /api/records?plate=PDF-3376`
- `POST /api/records`
- `GET /api/quote-template`
- `POST /api/quotes/calculate`
- `POST /api/ai/chat`
- `POST /api/ai/generate-report`
- `POST /api/ai/diagnosis`
- `POST /api/ai/maintenance-advice`
- `POST /api/ai/train`
- `GET /api/ai/training-set.jsonl`

## LLM 訓練說明

目前版本沒有在本機微調大型模型，而是採用可在課堂專案中展示的訓練流程：

1. 將計畫書、維修紀錄欄位與估價公式整理成知識庫。
2. 使用者可新增問答樣本，讓助手優先參考店內語氣與標準答案。
3. 可匯出 JSONL，作為後續 fine-tuning、評測或接 OpenAI / Gemini / Claude API 的資料集。
