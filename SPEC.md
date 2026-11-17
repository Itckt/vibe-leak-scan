# 漏唔漏 — AI 砌嘅 app 安全掃描器（v1 spec）

工作名稱：「漏唔漏」。Package 名：`vibe-leak-scan`。

## 1. 定位

**問題**：用 Lovable、Bolt、Replit、Cursor 幾日砌出嚟嘅 app，成日將密鑰漏喺前端 JS，或者 Supabase 冇開 Row Level Security，任何人都讀到成個資料庫。

**對手**：英文市場已經好逼（VibeCheck、Vibe App Scanner、vibe-eval、VibeSafely、unpwned，另外 Lovable 同 Replit 自己都內建咗掃描）。正面硬撼冇優勢。

**切入位（假設，未驗證）**：
1. **繁體中文市場**（香港、台灣）。搜尋見到嘅對手全部係英文介面同英文報告。
2. **報告附「修復 prompt」**：每個問題都有一段可以直接貼返落 AI builder 嘅指令，唔識 code 嘅人都修到。

**收費假設**（v1 唔做收費）：被動掃描免費；深度掃描一次性收費；每週監察月費。

## 2. v1 做乜

一個本機行到嘅 web app：貼 URL → 掃描 → 繁中報告。

### 2.1 被動掃描（任何 URL 都得，只攞瀏覽器正常會載入嘅公開資源）

- 攞 HTML，搵出所有 `<script src>` 同 inline script，下載 JS bundle（上限：30 個檔、每個 5 MB、總共 25 MB）。
- **密鑰偵測**（regex + 驗證）：

  | 類型 | 規則 | 嚴重度 |
  |---|---|---|
  | Supabase `service_role` JWT | JWT payload 解碼後 `role === "service_role"` | 嚴重 |
  | Supabase secret key | `sb_secret_…` | 嚴重 |
  | Supabase anon JWT / `sb_publishable_…` | 本身可以公開 | 資訊（提醒 RLS 一定要開） |
  | OpenAI | `sk-…` / `sk-proj-…` | 嚴重 |
  | Anthropic | `sk-ant-…` | 嚴重 |
  | Stripe secret / restricted | `sk_live_…` / `rk_live_…` | 嚴重 |
  | AWS access key | `AKIA…` | 高 |
  | GitHub token | `ghp_…` / `github_pat_…` | 嚴重 |
  | Slack token | `xox[baprs]-…` | 高 |
  | SendGrid / Resend | `SG.…` / `re_…` | 高 |
  | Telegram bot token | `\d{8,10}:[A-Za-z0-9_-]{35}` | 高 |
  | PEM 私鑰 | `-----BEGIN … PRIVATE KEY-----` | 嚴重 |
  | Google API key | `AIza…` | 低（Firebase 設計上公開，提醒要設限制） |

- **安全 header**：HTTPS、HSTS、CSP、`X-Frame-Options` 或 `frame-ancestors`、`X-Content-Type-Options`、`Referrer-Policy`。
- **Source map**：bundle 有 `sourceMappingURL` 而且個 `.map` 攞到 → 中（原始碼公開）。
- **平台辨識**：由 hostname 同 bundle 特徵估係 Lovable / Bolt / Replit / Vercel / Netlify，同埋用緊 Supabase 定 Firebase。

### 2.2 深度掃描（一定要先驗證擁有權）

**驗證方法**：系統出一個 token，用家放喺 `<meta name="laumlau-verify" content="TOKEN">` 或者 `/.well-known/laumlau-verify.txt`，系統讀到先解鎖。

解鎖之後：
- **Supabase RLS 檢查**：用 bundle 入面搵到嘅 project URL 同 anon key：
  1. 試讀 `/rest/v1/` 嘅 OpenAPI 列出 table；讀唔到就退而求其次，由 bundle 嘅 `.from("…")` 抽 table 名。
  2. 每個 table 做一次 `GET …?select=*&limit=1`。匿名讀到資料 → 嚴重。
  3. 報告只顯示 table 名同欄位名。**唔儲存、唔顯示任何一行資料嘅值。**
  4. 只用 GET。永遠唔寫、唔改、唔刪。
- **敏感檔案**：`/.env`、`/.env.local`、`/.git/config`、`/.git/HEAD`（要驗證內容似真，唔好將 SPA fallback 嘅 HTML 當中招）。

### 2.3 報告頁（繁體中文）

- 總評級（A–F）同一句總結。
- 問題按嚴重度排，每個有：係乜（白話）、點解有事、點樣修、**修復 prompt**（一撳複製）。
- 密鑰一律遮蓋：只顯示頭 6 同尾 4 個字元。
- 每份報告有獨立網址（隨機 ID，估唔到）。

## 3. 安全底線（一定要做）

- **防 SSRF**：只准 `http`/`https`；DNS 解析後擋晒 loopback、私有網段、link-local、metadata IP；每次 redirect 都要重新檢查；最多跟 5 次 redirect。測試用 `ALLOW_PRIVATE_TARGETS=1` 先可以掃本機。
- 每個請求 10 秒 timeout；每個 IP 每分鐘最多 5 次掃描。
- User-Agent 寫明係掃描器。
- 原始密鑰唔落 disk、唔入 log，只存遮蓋後嘅版本。
- 深度掃描一定要過擁有權驗證，冇後門。

## 4. 技術

- Node.js 22，ESM JavaScript，唔使 build step。
- Express 做 server；前端用純 HTML + CSS + 少量原生 JS，手機闊度睇得。
- 儲存：`data/` 入面嘅 JSON 檔（v1 唔用資料庫）。
- 測試：`node:test`。
- Dependency 越少越好。

## 5. v1 唔做

收費、登入帳戶、持續監察、PDF 匯出、Firebase 規則檢查、部署。

## 6. 點先算完成

1. `npm install` 之後 `npm test` 全過。
2. 測試包括：每種密鑰偵測（正例同反例）、JWT role 解碼、SSRF 擋截、header 檢查、擁有權驗證。
3. 有一個故意漏晒嘢嘅本機 fixture 網站，加一個整合測試：掃佢，確認搵到預期嘅問題。
4. Fixture 入面嘅假密鑰要用字串拼接砌出嚟，唔好成條寫死喺 repo（避免日後被 secret scanner 擋）。
5. `npm start` 喺 `http://localhost:3000` 行到，貼 URL 出到報告。
6. `README.md` 寫清楚點行、點測試。

## 7. v1.1：修復 prompt 加強

### 7.1 目標

用家唔識 code。佢將 prompt 貼落自己用緊嘅 AI 工具，AI 應該一次過改啱，而且唔會整出「假修復」（睇落修咗，其實條密鑰仲喺前端）。

### 7.2 工具選擇

報告頁問題清單上面加一排選擇：「你用哪個工具做這個網站？」

- 選項：Lovable、Bolt、Replit、程式碼代理（Cursor、Claude Code 等）、其他。
- 預設：`report.platforms` 入面啱啱得一個係 Lovable / Bolt / Replit 就揀佢，否則揀「其他」。
- 揀完即時換晒頁面上所有 prompt。
- 用 `localStorage` 記住選擇，讀寫都要包 `try/catch`，壞咗都照常顯示。

### 7.3 每個 prompt 固定五段

1. **背景**：掃描器發現咗乜，連埋遮蓋後嘅證據同位置（檔案路徑、資料表名、欄位名、header 名）。
2. **目標**：修好之後應該係點。
3. **步驟**：針對呢類問題同呢個工具嘅具體做法，用編號。
4. **不要做**：呢類問題常見嘅假修復。
5. **驗收**：點樣證明真係修好。

Prompt 用繁體中文書面語寫。永遠唔包含完整密鑰或任何資料列嘅值。

### 7.4 每類問題嘅重點

**私密密鑰外洩**（OpenAI、Anthropic、Stripe、GitHub、Slack、SendGrid、Resend、Telegram、AWS、PEM、`sb_secret_`）
- 步驟：用遮蓋後嘅開頭字元喺程式碼搵出用到條密鑰嘅地方；將呼叫搬去伺服器端函式；密鑰放入工具嘅 secret 儲存；前端改為呼叫自己嘅伺服器端函式。
- 伺服器端函式要驗證使用者身分或者限制用量，唔可以變成任何人都 call 到嘅公開代理。
- 不要做：
  - 唔好改用 `VITE_`、`NEXT_PUBLIC_`、`PUBLIC_`、`REACT_APP_` 開頭嘅環境變數，呢啲照樣會打包入前端。
  - 唔好用 base64、拆開字串、混淆嚟「收埋」條密鑰。
  - 唔好喺回覆、log 或註解輸出密鑰。
  - 唔好改動無關嘅功能同介面。
- 驗收：重新 build 之後，輸出嘅 JS 檔搵唔到嗰段開頭字元；再掃一次確認。

**Supabase `service_role` 密鑰**
- 同上，另外講明：前端只可以用 anon 或 publishable 密鑰加 RLS；需要特權嘅操作一律搬去伺服器端函式。

**可公開嘅密鑰**（Supabase anon / publishable、Google API key）
- Supabase：叫 AI 逐個資料表檢查 RLS 有冇開、政策係咪過闊。
- Google：講明要限制來源同可用 API（呢步係人手做，見 7.6）。

**匿名讀到資料表**（深度掃描）
- 背景要有資料表名同欄位名。
- 步驟：先問用家呢個表係咪本來就應該公開；唔係就 `alter table … enable row level security`，再寫最小權限嘅政策。
- 不要做：唔好寫 `using (true)` 嘅政策就當修好；唔好刪除或修改現有資料。
- 驗收：用匿名密鑰讀嗰個表，應該攞唔到任何資料。

**敏感檔案公開**（`.env`、`.git`）
- 由公開目錄同部署輸出移除；加入 `.gitignore`；檔案入面所有憑證當作已外洩。
- 驗收：嗰個網址傳返 404。

**Source map 公開**
- 正式環境停用 source map。
- 不要做：唔好淨係刪 `sourceMappingURL` 註解而留低 `.map` 檔。

**安全 header**
- 喺託管平台嘅設定檔加 header。偵測到 Vercel 就提 `vercel.json`，偵測到 Netlify 就提 `_headers`。
- 講明：如果平台唔支援自訂回應 header，要直接講出嚟，唔好扮做完。

### 7.5 各工具嘅分別

只可以用以下已查證嘅概念。**唔好寫任何選單路徑，亦唔好提未列喺度嘅平台功能。**

| 工具 | Prompt 入面點講 |
|---|---|
| Lovable | 密鑰放 Secrets，由 Edge Function 用 `Deno.env.get("名稱")` 讀；前端經 Edge Function 呼叫外部服務。 |
| Bolt | 密鑰放 Secrets，由 server function 讀；提醒部署去其他託管商之後要喺嗰邊重新設定。 |
| Replit | 密鑰放 Secrets，由後端程式以環境變數讀；前端經後端路由呼叫。 |
| 程式碼代理 | 搜尋成個 codebase；改 server route 或 serverless function；`.env` 加入 `.gitignore`；檢查 git 歷史有冇 commit 過條密鑰；行 build 再搜尋輸出。 |
| 其他 | 通用講法：伺服器端函式加伺服器端環境變數。 |

### 7.6 「你要自己做」提示

有啲步驟 AI 做唔到。喺 prompt **外面**、複製按鈕上面，用顯眼方式顯示：

- 私密密鑰：「AI 做不到這一步：請你親自到服務商後台撤銷舊密鑰並建立新密鑰。舊密鑰已經公開過，從程式移除後仍然有效。」
- Google API key：親自到雲端主控台限制來源同 API。
- 冇人手步驟嘅問題就唔顯示。

### 7.7 整份修復計劃

報告頂部加「複製整份修復計劃」按鈕，跟住所選工具出一個合併 prompt：

- 按嚴重度排，同類問題合併（例如十條外洩密鑰列成一個清單，共用一套步驟）。
- 叫 AI 逐項做，每完成一項報告一次先做下一項。
- 開頭列出所有「你要自己做」嘅步驟。
- 超過約 6000 字就只包「嚴重」同「高」，並喺 prompt 註明仲有其他問題。

### 7.8 連線補漏

v1 嘅 fallback 只處理「拒絕連線」。補埋「完全冇回應」：

- 仲有其他位址未試嘅時候，每個位址嘅連線階段（未建立連線之前）最多等 3 秒，過時當作連線失敗，試下一個。
- 最後一個位址用晒剩低嘅時間。
- 總時間仍然唔可以超過原本每個請求嘅時限同掃描 budget。
- SSRF 規則同位址釘選一樣唔變。

### 7.9 點先算完成

1. Prompt 生成係純函式（`src/prompts.js`），唔做任何 I/O。
2. 單元測試：每類問題 × 每個工具都生成到；五段齊；有遮蓋後證據；冇完整假密鑰。
3. 測試確認：私密密鑰類 prompt 一定有 `VITE_` 同 `NEXT_PUBLIC_` 警告；匿名讀取類一定有 `using (true)` 警告。
4. 舊報告（冇新欄位）照樣開到，自動用返舊嘅 `prompt` 欄位。
5. 落 disk 嘅報告 JSON 仍然冇完整密鑰（沿用現有測試，包埋新欄位）。
6. 連線補漏有測試：第一個位址冇回應、第二個正常，要喺時限內成功。
7. `npm test` 全過。

## 8. v1.2：真實網站實測之後嘅修正

背景：第一次掃真實網站（一個放喺 GitHub Pages 嘅純靜態站）搵到三個問題。HTML 得一個 `<script type="module" src="./app.js">`，而 `app.js` 入面 `import … from "./radar-core.js"`。掃描器冇跟呢個 import，報告寫「已讀取 1 個程式檔案」，冇任何提示。

### 8.1 跟埋 ES module 載入嘅檔案（最重要）

漏掃即係漏報，會令成份報告失去可信度。

**要跟嘅來源**：
- HTML 入面嘅 `<link rel="modulepreload" href="…">`。
- 已下載 JS 入面嘅靜態 import：`import x from "…"`、`import "…"`、`export … from "…"`。
- 字串字面值嘅動態 import：`import("…")`。

**規則**：
- 路徑相對於「import 佢嗰個檔」嘅網址解析。
- 要處理壓縮過嘅寫法，例如 `import{a as b}from"./chunk-abc.js"`，中間冇空格。
- 只跟以 `./`、`../`、`/` 或 `http(s)://` 開頭嘅路徑。裸模組名（例如 `"react"`）冇 import map 解析唔到，略過。
- 寧願多跟都唔好漏：誤判最多係多攞一個唔存在嘅檔。攞返嚟唔係 200、或者係 HTML（SPA fallback）就靜靜略過，唔當係程式檔。
- 去重，處理循環 import，最多跟 5 層。
- 沿用現有上限：全部 JS 檔合共 30 個、每個 5 MB、總共 25 MB、同一個掃描 budget。所有請求照樣經 `safeFetch`，SSRF 規則不變。

**報告要老實講覆蓋範圍**：
- `coverage` 加一個欄位記低「經 import 搵到嘅檔案」數目，報告頁顯示。
- 因為上限而未跟完，出提示。
- 有解析唔到嘅載入（裸模組名、非字面值嘅動態 import），出一個合併提示，講明呢啲檔案冇被檢查。
- `limitations` 文字更新：講明唔執行程式、唔解析 import map。

### 8.2 認得 GitHub Pages

- hostname 以 `.github.io` 結尾，或者回應 header `Server: GitHub.com` → 平台加入「GitHub Pages」。
- 用自訂網域嘅 GitHub Pages 站都會送呢個 `Server` header，所以兩個條件係「或」。

### 8.3 識睇 `<meta>` 標籤

而家只睇 HTTP header。用 `<meta>` 設定咗嘅保護會被當成冇，修好咗都繼續報錯。

| 檢查 | header | `<meta>` 計唔計 |
|---|---|---|
| CSP | `Content-Security-Policy` | 計：`<meta http-equiv="Content-Security-Policy" content="…">`，內容要有 `default-src` 或 `script-src` |
| Referrer | `Referrer-Policy` | 計：`<meta name="referrer" content="…">`，用現有同一套有效值判斷 |
| 防止被嵌入 | `X-Frame-Options` 或 CSP `frame-ancestors` | **唔計**：`frame-ancestors` 放喺 `<meta>` 會被瀏覽器忽略 |
| `nosniff` | `X-Content-Type-Options` | 唔計，只可以用 header |
| HSTS | `Strict-Transport-Security` | 唔計，只可以用 header |

只認 `<head>` 入面嘅 `<meta>`。

### 8.4 平台做唔到嘅嘢要講明

GitHub Pages 唔支援自訂 HTTP 回應 header。偵測到 GitHub Pages 嗰陣：

- **CSP、Referrer**：「可以怎樣修」同 prompt 改為叫人用 `<meta>` 標籤，並寫出標籤格式。CSP 嘅內容要按個站實際載入嘅資源決定，prompt 要叫 AI 先盤點再寫，唔好畀一條萬用政策。
- **防止被嵌入、`nosniff`**：問題卡加「平台限制」標記，講明呢個平台設定唔到；可行做法係喺前面加一層可以加 header 嘅 CDN 或代理，或者轉用支援自訂 header 嘅託管。Prompt 要叫 AI 直接講明限制，唔好扮修好。
- 嚴重度同評級**唔變**：風險唔會因為修唔到而消失，只係要老實講。
- 呢套「平台限制」邏輯只用喺已確認嘅 GitHub Pages。其他平台唔好猜。

### 8.5 點先算完成

1. Fixture 網站加一層：`app.js` import 一個 `./chunk.js`，再由 `chunk.js` 動態 import 另一個檔，假密鑰收喺第二、三層。整合測試確認掃到。
2. 單元測試：靜態 import、`export … from`、動態 import、`modulepreload`、壓縮寫法、相對路徑解析、裸模組名略過、循環、層數同檔案數上限（要有提示）、HTML fallback 唔當程式檔。
3. GitHub Pages 偵測：hostname 同 `Server` header 兩種都有測試。
4. `<meta>` 測試：有效嘅 meta CSP 同 meta referrer 唔再報；`<meta>` 入面嘅 `frame-ancestors` 照樣報「未限制網頁被嵌入」；`<body>` 入面嘅 `<meta>` 唔計。
5. GitHub Pages 嘅四個 header 問題：prompt 內容啱（兩個講 `<meta>`、兩個講平台限制），每個工具版本都有測試。
6. 舊報告照樣開到。落 disk 嘅報告仍然冇完整密鑰。
7. `npm test` 全過。
