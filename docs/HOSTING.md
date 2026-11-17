# 線上試用版部署

線上版沿用 Node.js 掃描器及釘選已驗證 IP 的網路層，需要能執行 Node.js 22 的後端。靜態檔案託管無法獨立提供掃描服務。

## Railway 免費試用部署

目前線上入口：[漏唔漏免安裝試用版](https://vibe-leak-scan-production.up.railway.app/)。2026-11-17 已完成部署，沒有加入信用卡或啟用付費方案。訪客使用掃描器不需要 Railway 帳戶。

| 項目 | 本次設定 |
| --- | --- |
| 來源 | 公開儲存庫 `https://github.com/Itckt/vibe-leak-scan`，`main` |
| 建置 | Railpack 自動辨識 Node.js；本次日誌為 Node.js 22.23.4、`npm install` |
| 啟動 | `npm run start` |
| 環境變數 | `HOSTED=1`、`PORT=3000`、`PUBLIC_ORIGIN=https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| 公開網址 | Railway 產生的 HTTPS 網域，轉送至 3000 埠 |
| 健康檢查 | `/healthz` |
| 規模 | US West、單一執行個體、單一 Node.js 程序 |
| 閒置處理 | 已開啟 Serverless 休眠，重新喚醒可能較慢 |

本次使用公開儲存庫網址，沒有安裝可存取私人儲存庫的 GitHub App。介面顯示自動部署不可用，因此更新來源後須在服務來源設定檢查更新並部署，不能假設推送 GitHub 就會更新線上服務。

Railway 官方目前列明 Free 毋須信用卡，首次試用為 30 日或 US$5 額度，用完後轉為每月 US$1 免費額度；這不是無限流量或全天候可用性保證。額度與免費政策以供應商為準。帳戶已顯示通過驗證；其他帳戶若只有 Limited Trial，對外連線可能受限，不應用付費升級或放寬掃描器防護來隱藏此限制。參見[價格](https://railway.com/pricing)、[免費試用與網路限制](https://docs.railway.com/pricing/free-trial)、[變數](https://docs.railway.com/variables/reference)及[休眠機制](https://docs.railway.com/deployments/serverless)。

已驗證公開首頁、狀態、健康檢查、安全標頭、私網阻擋、未驗證深度掃描及跨來源請求拒絕，共九項。沒有從線上服務掃描第三方網站；完整成功掃描的證據仍來自本機 fixture，見[驗證紀錄](../VERIFICATION.md)。

## Render 設定（備用）

| 項目 | 設定 |
| --- | --- |
| 儲存庫 | `https://github.com/Itckt/vibe-leak-scan` |
| 分支 | `main` |
| 執行環境 | Node.js，版本由 package.json 的 engines 指定 |
| 建置命令 | `npm ci` |
| 啟動命令 | `npm start` |
| 健康檢查 | `/healthz` |
| 環境變數 | `HOSTED=1` |
| 規模 | 單一執行個體、單一 Node.js 程序 |

Render 會提供 `PORT` 和 `RENDER_EXTERNAL_URL`；程式只在 `HOSTED=1` 時綁定 `0.0.0.0`，並用提供的 HTTPS origin 驗證 Host 與瀏覽器 Origin。其他託管環境須自行設定 `PUBLIC_ORIGIN=https://你的服務網域`，並由反向代理終結 TLS；不可含路徑、登入資料或自訂連接埠。

以上行為依 [Render 網路服務文件](https://render.com/docs/web-services)及[預設環境變數](https://render.com/docs/environment-variables)。免費方案會閒置休眠、首次重啟較慢，並有流量及執行時間限制，適合作品試用；詳見 [Render 免費方案限制](https://render.com/docs/free)。沒有以此設定承諾正式服務的可用性或容量。

## 線上版的資料與安全界線

- `HOSTED=1` 與 `ALLOW_PRIVATE_TARGETS=1` 不能同時使用，否則啟動失敗；執行中出現此組合也拒絕請求。
- 保留所有 DNS 位址驗證、IP 釘選、重新導向驗證、掃描時間與流量上限及深度掃描的擁有權驗證。
- 掃描配額由整個執行個體共用：每分鐘五次掃描、二十次擁有權請求，同時最多兩次掃描。不信任使用者提交的轉送標頭。
- 報告在再次遮蓋後只存記憶體，最多一小時、最多一百份，合計最多 32 MiB，每份最多 8 MiB。超過數量或總容量時先移除最舊報告；服務重啟會清除全部報告。
- 報告連結沒有帳戶登入保護；知道隨機連結的人可閱讀。介面會提示即時保存修復指令及謹慎分享連結。
- 未新增請求內容記錄；應用程式不把原始秘密或資料列值寫入檔案或日誌。託管供應商自身的網路中繼資料記錄不由此程式控制。
- 不使用多程序或多執行個體，避免報告、驗證狀態與配額分散。若日後擴展容量，需要重新設計共用儲存與配額。

未設定 `HOSTED=1` 時，原本的本機模式、磁碟報告及 fixture 測試方式不變。

## 目前部署狀態

Railway 線上試用版已啟用。先前 Render 帳戶在建立 Free 服務時被要求加卡驗證，因此沒有完成 Render 部署；未填寫或提交卡資料。免費方案不代表每個供應商或帳戶都毋須驗卡。詳見 [驗證紀錄](../VERIFICATION.md)。
