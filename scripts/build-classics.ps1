$ErrorActionPreference = 'Stop'
$root = 'C:\Users\n2000\Downloads\YZ_json'

function HtmlText([string]$html) {
  $s = $html -replace '<(script|style)[^>]*>[\s\S]*?</\1>', ''
  $s = $s -replace '<(br|p|div|li|h[1-6]|tr|blockquote)[^>]*>', "`n"
  $s = $s -replace '<[^>]+>', ''
  $s = [Net.WebUtility]::HtmlDecode($s)
  (($s -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ }) -join "`r`n")
}

function WikiPage([string]$title) {
  $encoded = [uri]::EscapeDataString($title).Replace('%2F','/')
  $u = 'https://zh.wikisource.org/zh-hant/' + $encoded
  $html = (Invoke-WebRequest -UseBasicParsing -Uri $u -Headers @{ 'User-Agent' = 'YZ_json research corpus builder/1.0' }).Content
  $start = $html.IndexOf('mw-parser-output')
  if ($start -gt 0) { $start = $html.LastIndexOf('<div', $start) }
  if ($start -lt 0) { throw "無法定位正文：$title" }
  $body = $html.Substring($start)
  $end = $body.IndexOf('<div class="printfooter"')
  if ($end -gt 0) { $body = $body.Substring(0, $end) }
  HtmlText $body
}

$header = "# 古籍全文資料集`r`n`r`n本檔由公開網頁版本整理取得。正文保留原站所用字形與標點；來源、版本及校勘限制見文末。`r`n`r`n"

$s1 = WikiPage '史記/卷003'
$s2 = WikiPage '史記/卷004'
($header + "## 殷本紀（史記卷三）`r`n`r`n$s1`r`n`r`n## 周本紀（史記卷四）`r`n`r`n$s2`r`n`r`n## 來源與版本`r`n`r`n- 維基文庫《史記/卷003》《史記/卷004》。`r`n- 另以中國哲學書電子化計劃《史記》目錄與篇頁交叉定位；未繞過其反爬限制。") | Set-Content (Join-Path $root '史記_殷本紀_周本紀.md') -Encoding utf8

$chapters = '泰誓上','泰誓中','泰誓下','牧誓','武成','洪範','旅獒','金縢','大誥','微子之命','康誥','酒誥','梓材','召誥','洛誥','多士','無逸','君奭','蔡仲之命','多方','立政','周官','君陳','顧命','康王之誥','畢命','君牙','冏命','呂刑','文侯之命','費誓','秦誓'
$sb = $header + "## 周書篇目`r`n`r`n"
$i = 0
foreach ($c in $chapters) {
  $i++
  $sb += "## $i. $c`r`n`r`n"
  try { $sb += WikiPage ("尚書/$c") } catch { $sb += "[此篇頁面未能取得：$c]" }
  $sb += "`r`n`r`n"
}
$sb += "## 版本說明`r`n`r`n- 篇目依維基文庫《尚書》「周書」分類，共32篇。`r`n- 部分篇章在傳統古文《尚書》中被標為偽作或有真偽爭議；此檔按傳世篇目收錄。`r`n- 來源：維基文庫《尚書》各篇頁。"
$sb | Set-Content (Join-Path $root '尚書_周書.md') -Encoding utf8

$b1 = WikiPage '竹書紀年 (四庫全書本)/卷上'
$b2 = WikiPage '竹書紀年 (四庫全書本)/卷下'
($header + "## 竹書紀年卷上（四庫全書本）`r`n`r`n$b1`r`n`r`n## 竹書紀年卷下（四庫全書本）`r`n`r`n$b2`r`n`r`n## 版本與校勘警告`r`n`r`n- 本檔是今本《竹書紀年》的《四庫全書》本，不是汲冢出土的西晉古本。`r`n- 今本與古本存在差異、增補及真偽問題，研究時應與《古本竹書紀年輯校》及諸書引文對照。`r`n- 來源：維基文庫《竹書紀年（四庫全書本）／卷上、卷下》。") | Set-Content (Join-Path $root '竹書紀年_四庫全書本.md') -Encoding utf8

$html = (Invoke-WebRequest -UseBasicParsing -Uri 'https://www.gongfa.com/index.php?c=show&id=13392' -Headers @{ 'User-Agent' = 'YZ_json research corpus builder/1.0' }).Content
$ps = [regex]::Matches($html, '<p[^>]*>(.*?)</p>', [Text.RegularExpressions.RegexOptions]::Singleline)
$lines = @()
foreach ($p in $ps) {
  $x = [Net.WebUtility]::HtmlDecode(($p.Groups[1].Value -replace '<[^>]+>', '')).Trim()
  if ($x -match '^(江陵王家台|王家台秦簡|王家台秦简|由于残缺|[0-9]+、|\*+|知北逰按)') { $lines += $x }
}
$gb = $header + "## 王家台秦簡《歸藏》公開釋文節錄`r`n`r`n> 注意：目前公開資料並未提供394支簡的完整、定本復原。以下是公開頁面所載的53條／節錄釋文；◇表示殘斷，□表示不識，方括號為整理補字或卦名整理。`r`n`r`n" + ($lines -join "`r`n`r`n") + "`r`n`r`n## 研究限制與來源`r`n`r`n- 王家台15號秦墓出土易占簡：編號164支，另有未編號殘簡230支，合計394支，約4000餘字；公開介紹指出殘缺嚴重、順序未定。`r`n- 本節錄頁面明言「現摘錄部分釋文」，並稱依王明欽《王家台秦墓竹簡概述》抄錄，不能視為完整定本。`r`n- 來源：公法評論網〈歸藏易 湖北江陵王家台秦簡本〉；交叉參考王寧〈傳本《歸藏》輯校〉及相關研究資料。`r`n- 學界對王家台易占是否即《歸藏》仍有討論；本檔沿用通行稱呼，但保留證據限制。"
$gb | Set-Content (Join-Path $root '王家台秦簡_歸藏易_公開釋文節錄.md') -Encoding utf8

Get-ChildItem $root -Filter '*.md' | Where-Object { $_.Name -match '史記_|尚書_|竹書|王家台' } | Select-Object Name, Length
