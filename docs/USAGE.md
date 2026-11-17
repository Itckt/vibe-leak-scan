# 漏唔漏使用指南

把自己的網站網址貼上，檢查前端密鑰、安全設定及可公開下載的原始碼對照檔，取得繁體中文報告與可直接複製的 AI 修復指令。規格以 [SPEC.md](../SPEC.md) 為準。

## 安裝及啟動

使用 Node.js 22.8 或以上的 22.x 版本。無需建置，也不需要任何服務金鑰。

```powershell
npm install
npm test
npm start
```

開啟 `http://localhost:3000`，貼上自己的網站網址，選擇掃描方式。服務只綁定 `127.0.0.1`。如需更換連接埠，在啟動前設定 `$env:PORT = '3001'`。使用 `Ctrl+C` 結束服務。

直接依賴只有 Express、parse5 與 ipaddr.js，分別用於 HTTP 服務、正確解析 HTML 與辨識 IP 位址範圍。所有 JavaScript 均使用 ESM。npm 快取放在本目錄的 `.npm-cache/`。

## 掃描方式

**被動掃描：** 讀取 HTML、內嵌程式、頁面引用的外部 JavaScript、模組預載、靜態匯入與字面值動態匯入，以及程式明確引用的來源對照檔。偵測規格內所有密鑰類型；Supabase 匿名及公開發佈密鑰只列為資訊，Google API 金鑰列為低風險。JWT 會解碼並檢查角色。工具不會拿密鑰呼叫供應商來測試有效性。

檢查 HTTPS、HSTS、CSP、網頁嵌入限制、內容類型與來源網址政策，並依 hostname 與程式特徵推測 Lovable、Bolt、Replit、Vercel、Netlify、Supabase 或 Firebase。GitHub Pages 只依 `.github.io` 子網域或 `Server: GitHub.com` 回應標頭辨識，包含使用自訂網域的網站。

**深度掃描：** 先在介面取得驗證碼，然後選擇一種方法：

1. 在網站首頁的 `<head>` 加入介面提供的 `<meta name="laumlau-verify" content="TOKEN">`。
2. 在網站建立 `/.well-known/laumlau-verify.txt`，內容只放該驗證碼。

按「已放好，驗證擁有權」，成功後才能開始深度掃描。驗證綁定通訊協定、主機及連接埠，十五分鐘後失效；服務重啟也會清除驗證。每次深度掃描都會重新讀取標記。直接呼叫 API、傳送 `verified: true` 或只取得驗證碼，都不能繞過這個門檻。首頁驗證只接受同來源重新導向；驗證檔不接受重新導向。若網站會轉至另一個網域或由 HTTP 轉至 HTTPS，請輸入最終網址重新驗證。

深度掃描會檢查 `/.env`、`/.env.local`、`/.git/config`、`/.git/HEAD`，並驗證內容格式，避免把單頁應用程式的 HTML 備援頁誤判為外洩。對可配對的 Supabase 專案，先用公開密鑰讀取 OpenAPI；無法列出資料表時，改用程式中的 `.from("…")` 名稱。每張資料表只送出一次 `GET …?select=*&limit=1`。報告只保留資料表名及欄位名，絕不儲存資料列的值。匿名可讀取資料列為嚴重風險，但不能單憑這次測試斷言 RLS 未啟用；也可能是政策過寬或資料刻意公開。空回應同樣不能證明 RLS 安全。

## 本機測試網站

測試網站故意暴露由字串在執行時拼接的假密鑰，並模擬來源對照檔、敏感檔案和 Supabase 匿名讀取。`app.js` 靜態匯入 `chunk.js`，再由後者動態匯入 `nested.js`；第二、三層分別放置假的 OpenAI 與 Anthropic 密鑰，用以驗證匯入追蹤。沒有任何真實憑證，也不連接外部服務。

在第一個 PowerShell 視窗啟動掃描器：

```powershell
$env:ALLOW_PRIVATE_TARGETS = '1'
npm start
```

在第二個視窗啟動測試網站：

```powershell
npm run fixture
```

開啟掃描器後，輸入 `http://127.0.0.1:4173`。這個設定只供掃描本機測試網站。要從介面測試深度掃描，先取得驗證碼，再停止測試網站，把介面產生的驗證碼放入以下環境變數並重新啟動：

```powershell
$env:FIXTURE_VERIFICATION_TOKEN = '貼上介面產生的驗證碼'
$env:FIXTURE_VERIFICATION_METHOD = 'meta'
npm run fixture
```

把 `FIXTURE_VERIFICATION_METHOD` 改為 `file` 可以測試驗證檔方法。測試網站沒有可遠端設定驗證碼的 HTTP 端點。

## 自動測試及 HTTP 驗證

```powershell
npm test
```

測試使用 `node:test`，涵蓋每類密鑰正反例、JWT 角色、所有安全標頭、SSRF 位址與 DNS、重新導向、DNS 位址釘選、逾時、檔案大小及總流量、速率限制、兩種擁有權驗證、過期和標記移除、SPA 備援頁、Supabase 備援查表、API 直呼拒絕與報告遮蓋。測試不會掃描真實第三方網站；只在需要本機 fixture 的案例中設定 `ALLOW_PRIVATE_TARGETS=1`，並在結束後還原。

測試採單一程序、循序執行，適用於限制建立子程序的環境。測試產生的報告放在 `data/test-*`，結束後只清除各測試建立的目錄。

保持以 `ALLOW_PRIVATE_TARGETS=1` 啟動的 `npm start` 運作，在另一個視窗執行：

```powershell
$env:ALLOW_PRIVATE_TARGETS = '1'
npm run verify:local
```

這個腳本會自行建立短暫本機 fixture，經由 `http://localhost:3000` 的 HTTP API 驗證未授權拒絕、被動掃描、擁有權驗證及深度掃描。它會讀回 `data/` 的報告，確認預期問題、所有完整假密鑰與資料列值均未落盤，再輸出通過及失敗數量。fixture 會自動停止，報告會保留供檢查。若同一分鐘內已提交五次掃描，請等候一分鐘再執行。

確認預設 SSRF 防護時，使用未設定例外的程序：

```powershell
Remove-Item Env:ALLOW_PRIVATE_TARGETS -ErrorAction SilentlyContinue
npm run verify:ssrf
```

腳本會建立預設設定的本機掃描器，向其 API 提交 `http://127.0.0.1`、`http://169.254.169.254`、`http://10.0.0.1`，要求三者都在對目標連線前收到 `403 / SSRF_BLOCKED`。

## HTTP API

所有寫入 API 的請求本文均為 JSON。錯誤回應使用 `{ "error": { "code": "…", "message": "繁體中文說明" } }`。以下的識別碼由服務產生。

| 方法與路徑 | 請求與用途 |
| --- | --- |
| `POST /api/scans` | `{ "url": "https://你的網站", "mode": "passive" }`，回傳報告識別碼與網址 |
| `POST /api/verifications` | `{ "url": "https://你的網站" }`，取得驗證識別碼、驗證碼、來源及期限 |
| `POST /api/verifications/:id/check` | `{}`，由伺服器讀取網站並檢查標記 |
| `POST /api/scans` | `{ "url": "https://你的網站", "mode": "deep", "verificationId": "驗證識別碼" }`，再次驗證後掃描 |
| `GET /api/reports/:id` | 取得已遮蓋的 JSON 報告 |
| `GET /report/:id` | 開啟繁體中文報告頁 |

## 安全設計與範圍

- 所有掃描請求只使用 GET，採明確的掃描器 User-Agent。只接受 HTTP／HTTPS，不接受網址內的帳號密碼。
- DNS 的所有結果都必須符合公開位址規則，並把實際連線固定到已檢查的 IP，防止二次 DNS 解析被替換。阻擋 loopback、私有網段、link-local、中繼資料及其他保留位址，包含 IPv6 與 IPv4 映射位址。每次重新導向都重新檢查，最多五次。
- 每個請求的 DNS、連線及回應讀取合共最多十秒；壓縮前後都受單一資源大小限制。每個來源 IP 每分鐘最多五次掃描，不信任轉送標頭；同時最多兩次掃描。另限制驗證請求頻率。
- 原始 HTML、程式碼、密鑰、資料列內容和上游錯誤只在記憶體暫存，沒有請求內容日誌。回報、錯誤與磁碟儲存均不輸出完整密鑰；顯示密鑰頭六與尾四個字元，來源網址省略查詢參數及片段。
- 報告寫在 `data/<隨機識別碼>.json`，識別碼含 192 位元隨機性，沒有列表 API。報告頁以文字節點呈現外部資料，設有 CSP，並禁止快取。知道連結的人可以讀取報告。
- 採保守資源上限：外部 JavaScript、模組預載與匯入共用三十個候選檔案名額，每個資源最多 5 MB，整次掃描共 25 MB、最長兩分鐘。失敗或 HTML 回退也佔候選名額，避免無限請求；成功讀取數另行計算。MB 採十進位計算；總額也包含 HTML、驗證、來源對照檔和深度檢查。來源對照檔最多三十個、Supabase 最多五個專案及每專案一百張資料表，超出時明確列出未完成項目。
- 不執行網頁、不解析 import map，也不爬取其他頁面。以保守字串掃描跟隨靜態匯入與字面值動態匯入，可能多讀取疑似引用；不保證涵蓋全部執行時資源。只檢查明確引用且可讀的有效第三版來源對照檔；不解碼內嵌資料網址。平台結果是特徵推測。
- Supabase 使用明確的 `createClient` 網址／公開密鑰組合，或可由標準專案網域與 JWT 專案識別碼配對的靜態文字；無法配對便略過並說明。不使用 `service_role` 或伺服器密鑰、不呼叫 RPC，也不把認證標頭轉送至其他來源。資料表與欄位名稱只接受最多六十三字元的英文字母、數字及底線識別字；無法檢查的項目不視為安全。
- 不包含收費、登入帳戶、持續監察、PDF 匯出、Firebase 規則檢查或部署功能。

## v1.1 修復指令與連線回退

報告的「你用哪個工具做這個網站？」提供 Lovable、Bolt、Replit、程式碼代理及其他五種選擇。沒有儲存選擇時，只有恰好偵測到其中一個建站工具才自動選取；否則使用「其他」。選擇會記在瀏覽器的 localStorage，讀寫失敗不影響顯示或複製。

每項指令固定包含背景、目標、編號步驟、不要做及驗收五段，附遮蓋後證據與位置。步驟針對問題類型及所選工具調整；涉及平台能力而無法確認時，要求 AI 明確說明限制。撤銷私密密鑰、限制 Google API 金鑰及更換敏感檔案中的憑證，會在指令外、複製按鈕上方另外顯示手動提示。

報告頂部的「複製整份修復計劃」會按嚴重度排序，合併同類問題並共用步驟，開頭列出手動事項。超過約 6000 字時，只保留嚴重及高風險問題並註明略過數量。此門檻是篩選條件；若嚴重及高風險內容本身仍超長，保留完整步驟，不截斷安全警告。密鑰外洩合併為一類，並保留 service_role、AWS、PEM 的額外要求；安全標頭按各標頭類型分組。舊報告保留其原有指令，不擅自補寫未知內容。

`src/prompts.js` 是無 I/O 的純函式模組，只接受已遮蓋的問題。掃描器完成整份報告遮蓋後才呼叫它。每個新問題包含 `prompts.lovable`、`prompts.bolt`、`prompts.replit`、`prompts.agent`、`prompts.generic`，以及需要時的 `manualStep`；原有 `prompt` 等於通用版本。舊報告沒有新欄位時，顯示與複製都回退到 `prompt`。前端以 textContent 呈現，CSP 維持原設定。

若還有其他已驗證位址可試，連線階段最多等待三秒，無回應便回退；最後一個位址使用剩餘時間。HTTPS 的連線階段包含 TLS 握手。連線建立後不會因三秒期限而中止回應讀取；所有位址仍共用每請求十秒及掃描預算。HTTP 狀態或回應開始後的錯誤不會重試。

```powershell
npm test
node scripts/prompt-samples.js
```

後者只印出兩份由已遮蓋範例產生的指令，不會掃描網站。測試包含五工具指令矩陣、警告與手動事項、舊報告、工具切換、合併與長度篩選、報告落盤遮蓋及無回應位址回退。

## v1.2 模組覆蓋範圍與 GitHub Pages

`src/imports.js` 使用字串掃描擷取靜態 import、`export … from` 與字面值 `import("…")`，支援壓縮後沒有空格的寫法；不執行下載的程式。HTML 的 `modulepreload` 也會納入。路徑相對於匯入檔案的最終網址解析，內嵌程式則使用文件的 base 網址。只跟隨 `./`、`../`、`/` 及 HTTP／HTTPS 路徑，去重並處理循環，入口檔之後最多跟隨五次匯入。

所有請求仍經 safeFetch，共用原有 SSRF、位址釘選、逾時及流量限制。非 200 或 HTML 回退會靜默略過，不當作程式檔；超出深度、檔案數或安全限制則顯示未完成提示。裸模組名、非字面值動態匯入及無法解析的載入會產生一個合併提示。`coverage.importedScripts` 記錄經匯入或模組預載找到且成功讀取的唯一檔案數；報告頁顯示該數目，舊報告缺少此欄位時顯示零。

安全政策檢查也讀取 `<head>` 內有效的 meta CSP 與 meta referrer；不計 `<body>` 內的標籤。meta CSP 中的 `frame-ancestors` 不構成嵌入保護，meta 的 HSTS、nosniff 也不生效。Referrer 沿用原有有效政策值判斷。

只有確認為 GitHub Pages 才套用平台限制：CSP 與 Referrer 的建議及五種工具指令提供 meta 標籤格式；CSP 要先盤點實際資源再寫政策。嵌入保護、nosniff 及同樣只能用 HTTP header 的 HSTS 標示「平台限制」，說明可加入能設定 header 的 CDN／代理或改用支援的託管；不降低嚴重度或評級，也不宣稱修改 meta 就已修復。其他平台仍先確認實際支援能力。

```powershell
node scripts/benchmark-imports.js
```

這個指令只在記憶體產生兩份 5 MB 單行輸入，測量擷取時間，不進行網路請求。本輪測試結果與效能實測見 [VERIFICATION.md](../VERIFICATION.md)。

## 專案結構

```text
vibe-leak-scan/
├─ SPEC.md
├─ README.md
├─ VERIFICATION.md
├─ package.json
├─ server.js
├─ src/             # 伺服器、掃描器、安全層、驗證與報告儲存
├─ public/          # 繁體中文網頁、樣式及原生 JavaScript
├─ fixtures/        # 執行時拼接假密鑰的本機測試網站
├─ tests/           # 單元及整合測試
├─ scripts/         # 本機 HTTP 與預設 SSRF 驗證
└─ data/            # 執行時建立；已由 .gitignore 排除
```

本輪實際執行的指令、結果及規格第 8.5 節逐項核對，請見 [VERIFICATION.md](../VERIFICATION.md)。
