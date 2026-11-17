# v1.2 修正案例：讓覆蓋範圍可以被核對

## 發現的問題

使用者提供的真站驗收指出，一個純靜態網站的 HTML 只引用入口程式，但入口又透過 ES module 載入另一個檔案。原本的掃描只下載第一層，報告寫出已讀取一個程式檔，卻沒有說明模組依賴未被檢查。

這個缺口會影響報告可信度：沒有掃到某個檔案，不能解讀成那個檔案沒有問題。因此 v1.2 同時處理資源發現與覆蓋範圍說明。

另一組回饋來自託管環境：網站使用 GitHub Pages，但平台未被辨識；報告只檢查 HTTP header，也會建議使用者修改該平台不支援的自訂 header。

## 具體修改

| 原有行為 | v1.2 行為 | 對應證據 |
| --- | --- | --- |
| 只跟 HTML 的 script 引用 | 加入靜態 import、重新匯出、字面值動態 import、modulepreload | `tests/imports.test.js` |
| 讀取數沒有交代模組來源 | 顯示成功讀取的匯入檔案數；超限及未解析載入產生提示 | `tests/report-v12.test.js`、`tests/imports.test.js` |
| 未辨識 GitHub Pages | 依 `.github.io` 或 `Server: GitHub.com` 判斷 | `tests/platforms-meta.test.js` |
| 只檢查 HTTP header | 也辨識 head 內有效的 CSP 與 referrer meta | `tests/platforms-meta.test.js` |
| 建議修改無法設定的 header | CSP／Referrer 提供 meta 格式；嵌入保護、nosniff、HSTS 說明平台限制 | 五個工具的指令矩陣測試 |

## 如何保留安全邊界

匯入擷取器只做字串掃描，沒有執行或評估下載內容。每個新 URL 仍交由 safeFetch 驗證；所有入口、預載與匯入共用三十個候選檔案名額、每檔 5 MB、總計 25 MB 與原有時間預算。循環依賴會去重，入口之後最多跟隨五次匯入。

擷取器會略過裸模組名、非字面值的動態載入及無法解析的路徑，並產生合併提示。這是有限的靜態分析，不能證明涵蓋所有執行時資源。

平台限制只在確認 GitHub Pages 後套用。meta CSP 的 frame-ancestors 不算嵌入保護；nosniff 與 HSTS 仍只計 HTTP header。CSP 修復指令要求先盤點實際資源，再寫政策。因為平台無法直接設定而留下的風險，不會被降級或當成已修好。

## 可重現的本機證據

Fixture 使用以下三層關係，所有密鑰都是執行時拼接的假資料：

```text
HTML
└─ assets/app.js
   └─ import "./chunk.js"
      ├─ 假 OpenAI 密鑰
      └─ import("./nested.js")
         └─ 假 Anthropic 密鑰
```

HTTP 整合測試要求報告包含第二、三層的密鑰發現位置，並斷言三個外部程式檔、其中兩個經匯入發現。測試讀回實際落盤 JSON，檢查完整假密鑰、跳脫與編碼形式、資料列值均不存在。

循環匯入、五層與三十檔上限、5 MB 單檔及 25 MB 總額、HTML 回退、SSRF 拒絕都有回歸測試。效能腳本另外產生兩份 5 MB 單行輸入；量測結果見 [VERIFICATION.md](../VERIFICATION.md)。一次快速完成的樣本，不代表所有輸入都具備相同耗時。

## 外部回饋與親自驗證分開記錄

使用者轉述的真站複查結果是：程式檔由一個增加至兩個，讀取位元組由 35,787 增至 53,546，與人工下載總和一致；平台改為 GitHub Pages，評級仍為 C。這些是使用者提供的外部驗收紀錄，本輪沒有對該網站重新掃描，也不公開其網址。

本輪作品截圖及掃描只使用本機 fixture。fixture 中出現 Lovable、Supabase、Firebase 特徵，不等於曾在那些平台驗證部署；目前仍缺少代表性的 AI builder／Vite 真實專案驗收。

## 後續可以驗證的方向

下一輪可使用獲授權的 AI builder 匯出專案，在本機重現打包後的載入關係，核對實際資源與報告覆蓋範圍。對每一種新載入方式，應同時回答「能否跟隨」及「不能跟隨時如何告知使用者」，再擴充測試。

[回到 README](../README.md) · [規格第 8 節](../SPEC.md) · [本機示範](SHOWCASE.md)
