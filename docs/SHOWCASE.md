# 本機示範與截圖

這組圖片於作品整理期間，在真實瀏覽器開啟本機服務後直接擷取；不是設計稿，也沒有把預期結果手動寫進頁面。畫面使用瀏覽器當時的預設窄視窗，不代表已完成所有手機尺寸驗收。

掃描器位於 `http://127.0.0.1:4300`，fixture 位於 `http://127.0.0.1:4174`。使用替代連接埠是為了避開當時已被佔用的 3000／4173；沒有停止其他既有服務。

需要現場演示時，可配合[三分鐘示範講稿](DEMO.md)使用；本頁保留圖片來源與環境重現細節。

## 首頁

網址、被動／深度掃描範圍與只讀限制。深度掃描需要擁有權驗證，按鈕並不構成驗證結果。

![本機掃描器首頁](images/home.jpg)

## 實際掃描報告

透過首頁表單提交本機 fixture，報告顯示三個外部程式檔，其中兩個經匯入或模組預載發現、一段內嵌程式及一個來源對照檔。Fixture 故意包含多種問題，因此出現 F 評級屬於測試設計，不是對某個真實網站的判斷。

平台標記來自 fixture 的特徵字串，並非平台端到端部署驗證。截圖只顯示摘要區域，完整報告保存在被忽略的 data/ 目錄，不納入作品檔案。

![本機 fixture 的實際掃描摘要](images/report.jpg)

## 已遮蓋的證據與修復指令

將工具切換為「程式碼代理」，再展開來自 `assets/chunk.js` 的 OpenAI 問題卡。已確認可見指令改為包含 codebase 搜尋與伺服器路由的版本。下圖是實際畫面的上半部分；完整指令仍有「不要做」與「驗收」段落，以及卡片下方的手動撤銷提示。

![匯入檔案的遮蓋證據與程式碼代理修復指令片段](images/fix-prompt.jpg)

圖片只包含本機網址及遮蓋後假密鑰，沒有真實憑證、真站網址、資料列值或系統桌面內容。

## 重現步驟

完成依賴安裝後，在第一個 PowerShell 視窗啟動掃描器：

```powershell
$env:PORT = '4300'
$env:ALLOW_PRIVATE_TARGETS = '1'
npm start
```

第二個視窗啟動 fixture：

```powershell
$env:FIXTURE_PORT = '4174'
npm run fixture
```

1. 開啟 `http://127.0.0.1:4300`。
2. 輸入 `http://127.0.0.1:4174`，選「被動掃描」並送出。
3. 核對覆蓋範圍為三個外部程式檔、其中兩個經匯入發現。
4. 切換工具，找到來源為 `assets/chunk.js` 的問題並展開指令。
5. 結束後在兩個視窗按 `Ctrl+C`；關閉測試視窗或移除該視窗的測試環境變數。

```powershell
Remove-Item Env:ALLOW_PRIVATE_TARGETS -ErrorAction SilentlyContinue
Remove-Item Env:PORT -ErrorAction SilentlyContinue
Remove-Item Env:FIXTURE_PORT -ErrorAction SilentlyContinue
```

原始 HTML 與 JavaScript 會在執行時包含完整假密鑰，請只截取掃描器的遮蓋報告，不把 fixture 回應、瀏覽器網路內容或 data/ 報告一併公開。

[回到 README](../README.md) · [完整使用指南](USAGE.md)
