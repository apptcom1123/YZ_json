# 易經整理

本倉庫整理《周易》本文、部分《易傳》資料，以及對應的 Markdown 與圖片資源，方便查閱、二次處理與程式使用。

另架設一簡單前端網站供使用者查看 : https://iching-reader-seven.vercel.app/

部分資料來自：

- https://github.com/john-walks-slow/open-iching
- 國易堂 (網站已失效)

如有錯漏，歡迎修正。

## Update
2026.07.11: This repo is created.

## 1. 項目結構

```text
.
├─ heluolishu/
│  └─ hllx_card.json
├─ iching/
│  ├─ iching.json
│  ├─ array-name_dict.json
│  ├─ array-symbol_dict.json
│  ├─ order_dict.json
│  └─ zhuan_dict.json
├─ ichuan/
│  ├─ tuan.json / tuan.html
│  ├─ xiang.json / xiang.html
│  ├─ wen.json / wen.html
│  ├─ xu.json / xu.html
│  └─ za.json
├─ md/
│  ├─ 易經.md
│  ├─ 易經_彖_象_文言_序卦.md
│  ├─ 文言.md
│  ├─ 序卦.md
│  ├─ 說卦.md
│  ├─ 系辭.md
│  ├─ 雜卦.md
│  └─ 占卜流程.md
├─ image/
│  └─ *.jpg
├─ public/
│  ├─ index.html
│  ├─ app.js
│  └─ style.css
├─ scripts/
│  └─ build.js
├─ .gitignore
├─ package.json
├─ process.ipynb
├─ Readme.md
└─ vercel.json
```

其中 `dist/` 是執行 `npm run build` 後產生的靜態網站，不納入 Git；`.vercel/` 是 Vercel CLI 的本機專案連結設定，也不納入 Git。

## 2. 內容說明

### `iching/`

《易經》本文與卦象索引資料。

- `iching.json`：六十四卦主資料。
- `array-name_dict.json`：卦爻陰陽陣列到卦名的對照。
- `array-symbol_dict.json`：卦爻陰陽陣列到卦象符號的對照。
- `order_dict.json`：卦名到卦序的對照。
- `zhuan_dict.json`：易傳篇目代號對照。

### `ichuan/`

《易傳》相關結構化資料與部分 HTML 原文。

- `tuan`：彖傳
- `xiang`：象傳
- `wen`：文言
- `xu`：序卦
- `za`：雜卦

其中：

- `.json` 以鍵值對方式保存段落內容。
- `.html` 保留較接近原始排版的文本版本。

### `md/`

可直接閱讀的 Markdown 版本。

### `heluolishu/`

河洛理數相關資料。

- `hllx_card.json`：河洛理數卡片資料，共 448 筆。

### `process.ipynb`

資料整理與處理用 Notebook。

## 3. 數據格式

### `iching/iching.json`

```json
[
  {
    "id": 1,
    "name": "乾",
    "symbol": "䷀",
    "array": [1, 1, 1, 1, 1, 1],
    "combination": ["乾", "乾"],
    "scripture": "元亨利貞。",
    "lines": [
      {
        "id": 1,
        "type": 1,
        "name": "初九",
        "scripture": "潛龍，勿用。",
        "image": "",
        "poetry": ""
      }
    ],
    "image": "",
    "poetry": ""
  }
]
```

欄位說明：

| 欄位 | 說明 |
| ---- | ---- |
| `id` | 卦序，1 至 64 |
| `name` | 卦名 |
| `symbol` | 卦象符號 |
| `array` | 六爻結構，`1` 為陽爻，`0` 為陰爻 |
| `combination` | 上下卦組合 |
| `scripture` | 卦辭 |
| `lines` | 爻辭列表 |
| `lines[].id` | 爻序 |
| `lines[].type` | 爻性，`1` 為陽爻，`0` 為陰爻 |
| `lines[].name` | 爻名 |
| `lines[].scripture` | 爻辭 |
| `lines[].image` | 圖像位址 |
| `lines[].poetry` | 詩詞內容 |
| `image` | 預留圖片欄位 |
| `poetry` | 預留附加文本欄位 |

### `iching/*.json` 詞典資料

```json
{
  "111111": "乾"
}
```

實際用途依檔名而異，用於卦名、卦象或卦序查找。

### `ichuan/*.json`

```json
{
  "iching__1": "大哉乾元，萬物資始，乃統天。",
  "iching__2": "至哉坤元，萬物資生，乃順承天。"
}
```

欄位說明：

| 鍵名格式 | 說明 |
| -------- | ---- |
| `iching__數字` | 對應某一卦的易傳內容 |
| `#數字` | 用於雜卦等成對段落編號 |

### `heluolishu/hllx_card.json`

```json
[
  {
    "id": 1,
    "text": "運覆無窮立建功，乾分四德萬方同。",
    "created_at": "2025-10-12T22:25:39.000243Z"
  }
]
```

欄位說明：

| 欄位 | 說明 |
| ---- | ---- |
| `id` | 卡片編號 |
| `text` | 詩訣正文，保留換行 |
| `created_at` | 建立時間，ISO 8601 格式 |

### 易傳篇目代號

`iching/zhuan_dict.json` 內容如下：

| 名稱 | id | 備註 |
| ---- | -- | ---- |
| 彖傳 | `tuan` | 解釋卦辭 |
| 象傳 | `xiang` | 解釋卦象與義理 |
| 文言 | `wen` | 述《乾》《坤》之德 |
| 說卦 | `shuo` | 述八卦象義與《易》大要 |
| 序卦 | `xu` | 說明六十四卦次序 |
| 雜卦 | `za` | 兩卦對舉，概括卦意 |
| 繫辭 | `ji` | 《易》後附義理文字 |

## 4. 本地網站試用

網站採純靜態架構。Vercel 部署時會執行 `scripts/build.js`，將 `public/`、`iching/iching.json`、`image/` 與 `md/` 整理至 `dist/`，不需要另外架設 Node.js HTTP 伺服器或資料庫後台。

### 4.1 安裝 Node.js

前往 [Node.js 官方網站](https://nodejs.org/)下載並安裝 LTS 版本。安裝完成後重新開啟終端機，確認版本：

```bash
node --version
npm --version
```

### 4.2 取得專案

使用 Git：

```bash
git clone https://github.com/apptcom1123/YZ_json.git
cd YZ_json
```

若已下載專案，直接進入專案目錄：

```bat
cd C:\Users\n2000\Downloads\YZ_json
```

### 4.3 建置靜態網站

```bash
npm run build
```

成功後會產生 `dist/`，其中包含可部署的首頁、JavaScript、CSS、六十四卦 JSON、Markdown 原文與圖片。

Windows PowerShell 若因執行原則無法執行 `npm.ps1`，可改用：

```bat
npm.cmd run build
```

### 4.4 在本機預覽

先完成 `npm run build`，再啟動靜態網站預覽：

```bash
npm run preview
```

第一次執行時，`npx` 會自動下載 `serve`。然後用瀏覽器開啟終端機顯示的本機網址，預設通常為：

```text
http://localhost:3000
```

Windows PowerShell 若因執行原則無法執行 `npm.ps1`，可改用：

```bat
npm.cmd run preview
```

按 `Ctrl + C` 可停止本機預覽。

### 4.5 安裝 Vercel CLI 並部署

```bash
npm install --global vercel
vercel login
```

Windows PowerShell 若無法執行 `vercel.ps1`，請使用：

```bat
vercel.cmd login
```

首次建立或連結 Vercel 專案並產生預覽部署：

```bash
vercel
```

確認預覽正常後部署至正式環境：

```bash
vercel --prod
```

Windows PowerShell 可對應使用：

```bat
vercel.cmd
vercel.cmd --prod
```

專案已透過 `vercel.json` 指定 `npm run build` 為建置指令、`dist` 為輸出目錄。部署完成後，Vercel 顯示的 `Aliased` 網址是適合公開分享的固定網址。

螢光筆註解只保存在使用者瀏覽器的 `localStorage`，不會上傳至 Vercel 或任何資料庫。清除網站資料、切換瀏覽器、裝置或網域時，註解不會自動同步。

## 版權聲明

數據採集自互聯網，僅供學習交流使用，不得用於商業用途。
