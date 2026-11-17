# 六個安全測試導覽

這份導覽選出六個既有測試，方便評審快速核對具體主張。它不是完整測試套件的替代品，也不新增掃描目標或執行下載的 JavaScript。

## 執行方式

在專案根目錄、依賴已安裝的 Node.js 22.x 環境執行：

```powershell
node --test --experimental-test-isolation=none --test-concurrency=1 --test-name-pattern='HTTP scan finds fixture leaks|unverified deep HTTP requests|mixed public and private DNS answers|pins DNS to the validated|five import edges|unresolved imports across files' tests/network.test.js tests/integration.test.js tests/imports.test.js
```

這個命令依名稱挑選六個測試。需要 HTTP 的案例自行建立本機 fixture、在個別案例設定測試例外並於結束後還原；混合 DNS 拒絕案例會取消例外。測試會使用 data/ 下的暫存目錄，不需先啟動 npm start，也不需要真實憑證。

## 每個測試證明甚麼

| 測試名稱辨識片段 | 觀察的斷言 | 可以支持的主張 |
| --- | --- | --- |
| `mixed public and private DNS answers` | 回傳 SSRF_BLOCKED，HTTP request 呼叫次數為零 | 混合公開／私有 DNS 結果在連線前整組拒絕 |
| `pins DNS to the validated` | 本機 fixture 成功回應，resolver 只被呼叫一次 | 連線使用已驗證位址，沒有再次查 DNS |
| `unverified deep HTTP requests` | 偽造旗標或驗證 ID 仍回傳 403；fixture 請求數為零，沒有報告落盤 | 直接 HTTP API 呼叫不能繞過深度掃描門檻 |
| `HTTP scan finds fixture leaks` | 經 HTTP 掃描後讀回磁碟 JSON；完整、跳脫與編碼假密鑰及資料列值均不在報告中；日誌無完整假密鑰 | 遮蓋保護涵蓋這組 fixture、指令欄位與報告儲存流程 |
| `five import edges` | 成功讀取入口加五層，未請求第六層，報告含五層上限提示 | 匯入深度受限制，省略的部分會告知使用者 |
| `unresolved imports across files` | 可解析的路徑繼續讀取；跨檔裸模組名及非字面值載入只產生一個合併提示 | 無法解析的載入不被當成已檢查，也不阻止其餘可處理的路徑 |

前兩項位於 [network.test.js](../tests/network.test.js)，中間兩項位於 [integration.test.js](../tests/integration.test.js)，最後兩項位於 [imports.test.js](../tests/imports.test.js)。

## 如何讀懂斷言

「API 回傳 403」只證明拒絕結果；同一個門檻測試另外檢查 fixture 請求數為零，才支持沒有先掃描再報拒絕。磁碟目錄為空的斷言，則涵蓋沒有替遭拒請求留下報告的行為。

遮蓋測試直接讀取磁碟 JSON，而不是只檢查畫面上是否有省略號。它同時遍歷各個工具指令；然而，所有 fixture 都通過仍不足以證明未知密鑰格式必定會被識別。

匯入測試同時核對成功讀取數、沒有請求的深層路徑與報告提示。這讓「有上限」和「誠實呈現上限」成為可以分別檢查的行為。

## 完整驗證另外涵蓋的項目

```powershell
npm test
```

完整套件還包含重新導向、位址回退及共用時限、流量與解壓後大小限制、驗證過期與標記移除、五工具指令、安全 header／meta 判讀、舊報告及剪貼簿備援。

效能量測另執行 `node scripts/benchmark-imports.js`。實際通過數、耗時及執行環境應以 [VERIFICATION.md](../VERIFICATION.md) 為準，不把預期結果當成已執行結果。

[回到 README](../README.md) · [三分鐘示範](DEMO.md) · [設計取捨](DESIGN-REVIEW.md)
