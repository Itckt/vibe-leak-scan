# v1.2 驗證紀錄

各階段分開記錄親自執行的檢查。使用者轉述的真站驗收另列於作品案例，不當成本輪重新執行的結果。

## GitHub 發佈與線上模式本機驗證：2026-11-17

已建立公開儲存庫 `Itckt/vibe-leak-scan`，並推送 `main`；首次推送的遠端 SHA 為 `307d9e4e5e8596149c2800a2fb5830e325775846`，與正式副本相同。使用者隨後要求免安裝的線上服務，因此新增明確啟用的線上模式、HTTPS origin 檢查、共用掃描配額及有容量和期限限制的記憶體報告。預設本機模式仍保留。

本輪親自執行：

| 指令 | 結果 |
| --- | --- |
| `npm test`（首次新增線上測試後） | **308 通過、4 失敗**；新增測試的 fetch 用戶端沒有保留模擬反向代理的 Host，請求在 Host 門檻被拒 |
| `npm test`（測試改用原生本機 HTTP 請求後） | **312 通過、0 失敗**；無取消、略過或待辦；約 4,803 ms |
| `Remove-Item Env:ALLOW_PRIVATE_TARGETS -ErrorAction SilentlyContinue; npm run verify:ssrf` | **3 通過、0 失敗** |
| `$env:ALLOW_PRIVATE_TARGETS = '1'; node data/verify-formal-copy.mjs` | **14 通過、0 失敗**；只使用本機 fixture |

新增二十四項測試涵蓋設定拒絕、Host 與 Origin、轉送標頭不可繞過共用配額、公開模式仍拒絕私網及未驗證深度掃描、報告到期、容量及遮蓋。修正的是測試送出 Host 的方式，沒有放寬服務的 Host 檢查。

線上模式的程式已以 commit `4dda288ef79f03b1104151732b662b55259b128a` 推送 GitHub。已完成 Render 註冊，並填妥新加坡區域、Free（$0／月）、`npm ci`、`npm start`、`HOSTED=1` 及 `/healthz`。提交建立服務後，平台要求新增信用卡，頁面說明會作 US$1 暫時授權；未填卡或提交付款，因此沒有完成部署，也沒有可交付的線上掃描網址。

上述 312／3／14 項結果均為本機驗證；不能當成託管環境已部署成功或已實際掃描外部網站的證據。沒有掃描真實第三方網站，也沒有重跑效能量測。

## 作者與套件資料修訂：2026-11-17

依使用者指示在正式副本設定 repo local 身分：`itckt <itckt@users.noreply.github.com>`，沒有修改 global Git 設定。分支為 `main`，`package.json` 與 `package-lock.json` 的專案版本均更新為 `1.2.0`。LICENSE 及中英 README 署名改為 itckt，刪除專案 `.npmrc`、發佈準備文件及兩份 README 中相應的連結。

親自在移除 `.npmrc` 後執行：

| 指令 | 結果 |
| --- | --- |
| `npm install` | 結束碼 0；依賴已是最新的 lockfile 狀態；npm 審核 69 個套件，回報 0 個漏洞 |
| `npm test` | **288 通過、0 失敗**；無取消、略過或待辦；結束碼 0；約 4,432 ms |

本次修改納入現有首個 commit，採用 `git commit --amend --no-edit --reset-author` 重設作者。沒有新增 remote 或推送，也沒有修改掃描行為。本輪沒有重跑獨立 SSRF、API 回歸腳本或瀏覽器檢查；下方保留先前實際執行的結果。

## 正式副本驗證：2026-11-17

使用者撤銷不搬移、不 commit、暫不授權的限制，並交由助理採用預設。正式版本放在使用者 Projects 下的 `vibe-leak-scan`，原工作目錄保留作備份；加入 MIT 授權及 package metadata，未修改掃描行為或偵測規則。

只複製 Git 候選清單中的 **60 個檔案**，逐一核對 SHA-256 相同。已安裝的 `node_modules/` 另行複製並維持忽略；沒有重新安裝依賴，沒有複製舊報告、快取或原 Git 中繼資料。正式副本使用新的本機 Git 儲存庫。

以下指令均在正式副本親自執行，結束碼均為 0：

| 指令 | 結果 |
| --- | --- |
| `npm test` | **288 通過、0 失敗**；無取消、略過或待辦；約 4,313 ms |
| `Remove-Item Env:ALLOW_PRIVATE_TARGETS -ErrorAction SilentlyContinue; npm run verify:ssrf` | **3 通過、0 失敗**；loopback、中繼資料及私有網段均在目標連線前被拒 |
| `$env:ALLOW_PRIVATE_TARGETS = '1'; node data/verify-formal-copy.mjs` | **14 通過、0 失敗**；只使用本機 fixture |
| `node data/check-portfolio.mjs` | **60 個候選檔案、86 個相對連結、0 項旗標**；三張 JPEG 均無 EXIF 區塊 |

需要本機 HTTP 的測試經核准在沙箱外執行。臨時 `data/verify-formal-copy.mjs` 以 `createApp()` 啟動 `127.0.0.1` 的系統分配埠，將 `scripts/verify-local.js` 的 appOrigin 改成該位址後執行相同十四項檢查，完成後關閉自己的服務。它保留原腳本的檢查名稱；本輪沒有另執行 `npm start`。臨時腳本、測試日誌及新產生的 fixture 報告均由 `data/` 忽略規則排除，不納入 commit。

本輪沒有重新拍攝截圖、重跑效能量測或掃描真實網站；圖片和先前親自執行的效能結果保留於下方紀錄。檔案檢查只涵蓋列出的規則與候選檔案，不能證明所有形式的私人資料都不存在。

提交前的 `git diff --cached --check` 首次報告既有行尾空白、檔尾空行及 CRLF 行尾；包裝腳本隨即以結束碼 1 停止，當時未建立 commit。後續只清除 `src/prompts.js` 的一處行尾空白與 `docs/USAGE.md` 的多餘檔尾空行，沒有修改程式行為；以 `git -c core.whitespace=cr-at-eol diff --cached --check` 接受 Windows 換行並重新檢查。

此階段當時使用專案佔位身份，未設定個人或 GitHub 帳戶身份；後續已按使用者提供的資料重設首個 commit 作者，見本頁最上方紀錄。沒有新增 remote 或公開發佈。以下較早紀錄描述各階段當時的狀態，不代表目前仍待選擇授權或目錄。

## 原準備清單收尾：2026-11-17

依使用者指示回到原清單，補齊 `README.en.md`，與繁體中文 README 互相連結；應用程式的介面、報告及修復指令仍為繁體中文。現有本機實拍圖片繼續使用，沒有為本輪修改產品程式或新增掃描。

親自執行 `node data/check-portfolio.mjs`：**59 個候選檔案、84 個相對連結、0 項旗標**，三張 JPEG 沒有 EXIF 區塊。另列出候選文字檔的 HTTP／HTTPS 網址引用，核對為本機或保留位址測試、範例及 fixture、程式佔位符、SVG 命名空間與依賴下載／贊助連結；未發現使用者真站網址。不讀取既有 data/ 報告，沒有對列出的網址送出請求。

這個階段沒有重跑產品測試，當時最近親自執行的完整套件與六項導覽結果分別保留在下方。搬移、LICENSE 及首個 commit 當時尚待使用者釐清；後續決定與正式副本驗證見本頁最上方。

## 展示文件補充：2026-11-17

新增三分鐘示範講稿、設計取捨與程式導覽、六個安全測試導覽，並更新 README 與文件入口。這一輪只改文件，沒有修改產品程式或測試；示範時間是預備編排，沒有錄製影片或實測整段演示耗時。

親自執行測試導覽內的原樣命令：

```powershell
node --test --experimental-test-isolation=none --test-concurrency=1 --test-name-pattern='HTTP scan finds fixture leaks|unverified deep HTTP requests|mixed public and private DNS answers|pins DNS to the validated|five import edges|unresolved imports across files' tests/network.test.js tests/integration.test.js tests/imports.test.js
```

結果為 **6 通過、0 失敗**，無取消、略過或待辦，結束碼 0，約 419 ms。這六項來自既有測試，沒有增加完整套件的測試數。因本機 HTTP 的沙箱限制，經核准在沙箱外執行，目標仍只限本機 fixture。

另執行 `node data/check-portfolio.mjs`：**58 個候選檔案、58 個相對文件連結、0 項旗標**，既有三張圖片均為 JPEG 且沒有 EXIF 區塊。文字規則檢查不能取代完整人工秘密稽核。

這一輪沒有重跑完整 288 項套件、獨立 SSRF／端到端腳本或效能量測，也沒有新增瀏覽器驗收；這些先前親自執行的結果保留在下方。沒有搬移、commit、加入 LICENSE 或發佈。

## 作品整理階段：2026-11-17

本輪只修改作品文件及新增截圖，沒有更動掃描邏輯、偵測規則、介面程式、CSP 或依賴。沒有搬移專案、建立 commit 或公開發佈；依使用者選擇，暫不加入 LICENSE。

### 本輪親自執行

| 指令／檢查 | 結果 |
| --- | --- |
| `npm test` | **288 通過、0 失敗**；無取消、略過或待辦；結束碼 0 |
| `Remove-Item Env:ALLOW_PRIVATE_TARGETS -ErrorAction SilentlyContinue; npm run verify:ssrf` | **3 通過、0 失敗**；結束碼 0 |
| `$env:ALLOW_PRIVATE_TARGETS = '1'; node data/verify-local-portfolio.mjs` | **14 通過、0 失敗**；結束碼 0；副本只把測試服務位址改為 4300，見下方 |
| `node scripts/benchmark-imports.js` | **2 通過、0 失敗**；5 MB 單行壓縮樣本 **128.35 ms**，未完成宣告樣本 **247.55 ms** |
| `node data/check-portfolio.mjs` | 55 個候選檔案、27 個本機文件連結；0 項旗標；三張圖片均為 JPEG、無 EXIF 區塊 |
| 真實瀏覽器本機流程 | 首頁提交 fixture 成功；報告顯示三個外部程式檔、其中兩個經匯入發現；工具切換為程式碼代理後，展開指令呈現對應內容 |

本機示範以以下指令啟動，產生三張截圖；沒有掃描第三方網站：

```powershell
$env:PORT = '4300'; $env:ALLOW_PRIVATE_TARGETS = '1'; npm start
$env:FIXTURE_PORT = '4174'; npm run fixture
```

3000 埠被其他程序佔用，因此沒有拿既有服務做回歸，也沒有修改原始 `scripts/verify-local.js`。本輪以以下指令建立被忽略的臨時副本，再執行相同十四項檢查：

```powershell
$portfolioVerify = Get-Content -LiteralPath scripts/verify-local.js -Raw -Encoding UTF8
$portfolioVerify = $portfolioVerify.Replace('http://localhost:3000', 'http://127.0.0.1:4300')
Set-Content -LiteralPath data/verify-local-portfolio.mjs -Value $portfolioVerify -Encoding UTF8
$env:ALLOW_PRIVATE_TARGETS = '1'; node data/verify-local-portfolio.mjs
```

`data/check-portfolio.mjs` 也是本輪臨時核對工具，不屬於發佈檔案。它讀取 Git 候選清單，檢查既有密鑰格式、個人絕對路徑、非範例電郵、文件相對連結及圖片格式；只輸出類型與位置。圖片另外逐張目視確認，只包含本機頁面及已遮蓋假資料。這些結果不構成完整個資或秘密稽核保證。

### 遇到的環境問題與驗證界線

- 沙箱中的本機連線遭 `EACCES` 阻擋；獲准後改在沙箱外執行需要本機 HTTP 的驗證。
- 兩次以 3000 啟動服務均以結束碼 1 離開，檢查確認為 `EADDRINUSE`；改用 4300 後成功。
- 第一次示範掃描 4173 無法讀取資源；改用沙箱外啟動的 4174 fixture 後成功。失敗頁面沒有當作完成截圖。
- 截圖使用瀏覽器預設窄視窗。未重做全部桌面／手機斷點、系統剪貼簿或 LINE／Instagram／Threads webview 驗收，也未驗證真實 AI builder 部署。
- 沒有重新安裝依賴，沒有加入 LICENSE，沒有掃描真實第三方網站。

## v1.2 實作階段：原始紀錄

以下保留 v1.2 實作當輪親自執行的結果；「本輪」在此以下均指實作階段，而非上方的作品整理階段。

## 實際指令與結果

完整測試執行兩次，第二次加入匯入 SSRF 與報告渲染回歸測試：

```powershell
npm test > data/v12-test-output.txt 2>&1; Get-Content -Encoding UTF8 data/v12-test-output.txt | Select-Object -Last 24
npm test > data/v12-test-output.txt 2>&1; Get-Content -Encoding UTF8 data/v12-test-output.txt | Select-Object -Last 15
node scripts/benchmark-imports.js
```

| 檢查 | 實際結果 |
| --- | --- |
| 第一次 `npm test` | 285 通過、0 失敗 |
| 第二次 `npm test` | **288 通過、0 失敗**；無取消、略過或待辦；約 5.20 秒 |
| 5,000,000 位元組單行壓縮輸入 | **130.47 毫秒**；擷取兩個去重網址；1 通過、0 失敗 |
| 5,000,000 位元組重複未完成宣告與字串 | **237.68 毫秒**；回報未解析載入；1 通過、0 失敗 |

效能數字是本機單次測量，包含擷取及去重，不包含資料產生與網路時間，不是所有機器的效能保證。擷取器以單向掃描處理字串與註解，不使用巢狀無界量詞，也不執行下載的 JavaScript。

## 第 8.5 節逐項核對

1. **完成。** Fixture 的 `app.js → chunk.js → nested.js` 使用靜態及動態匯入；第二、三層包含執行時拼接的假密鑰。HTTP 整合測試確認兩個檔案各自的密鑰發現位置，並斷言讀取三檔、其中兩檔經匯入發現。
2. **完成。** `tests/imports.test.js` 涵蓋靜態／副作用匯入、重新匯出、字面值動態匯入、壓縮語法、註解與跳脫、相對及絕對路徑、modulepreload、內嵌匯入、去重與循環、裸模組名及非字面值合併提示、五層與三十檔上限提示，以及非 200／HTML 回退靜默略過。另驗證匯入仍受 5 MB、25 MB 及 SSRF 限制。
3. **完成。** `tests/platforms-meta.test.js` 同時測試 `.github.io` hostname 和自訂網域的 `Server: GitHub.com`，也測試相似惡意 hostname、程式文字和其他 Server 值不會被誤認。
4. **完成。** 有效 head meta CSP 與 referrer 不再報缺失；meta frame-ancestors 仍報嵌入問題；body、template 及註解中的 meta 不計。HSTS、nosniff 與 X-Frame-Options 仍只計 HTTP header。測試亦核對有效／無效／寬鬆 referrer 值及 HTTP 設定。
5. **完成。** 五種工具逐一測試 CSP、Referrer 的實際 meta 格式，以及嵌入保護、nosniff 的平台限制與 CDN／代理／託管替代方案。HSTS 也有同樣矩陣。確認 CSP 要先盤點資源、不能套萬用政策；其他平台不套 GitHub Pages 限制，合併計劃也保留正確指引。原嚴重度和評級不變。
6. **完成。** 既有舊報告 API、指令回退測試通過；新增以實際 report.js 配合 DOM 替身驗證缺少新 coverage 欄位仍能渲染，以及「平台限制」標記與文字安全呈現。HTTP 整合測試讀取落盤 JSON，確認完整假密鑰（包含各匯入層及所有新 prompt 欄位）、編碼形式及資料列值均不在其中，日誌也無完整密鑰。
7. **完成。** 最終 `npm test` 288 通過、0 失敗，包含既有擁有權門檻、SSRF、位址釘選、連線回退、遮蓋、複製備援與指令測試。

## 採用的解讀

- 深度以入口檔為零，最多再跟隨五次匯入；模組預載視為入口，內嵌匯入也會追蹤。
- 三十檔上限計算去重後的候選名額，包含失敗或 HTML 回退；成功讀取數才計入 coverage。匯入及模組預載共用 importedScripts 計數。
- HSTS 與 nosniff 同樣只支援 HTTP header，因此確認 GitHub Pages 且缺少有效 HSTS 時，也顯示平台限制。
- 多個 referrer 設定沿用現有有效值判斷，取最後有效值；無效 meta 不會抹掉已有的有效 HTTP 政策。

## 驗證界線

本輪所有掃描只對本機測試伺服器進行；GitHub Pages 行為由本機回應標頭及純函式輸入模擬，沒有掃描任何第三方網站。測試內啟動 HTTP 服務並提交掃描、讀回報告；沒有另外執行 npm start、verify:ssrf 或 verify:local，沒有重新安裝依賴。

報告渲染使用 DOM 替身測試，沒有操作真實瀏覽器或手機 webview。CSP 設定未放寬，沒有提交版本。
