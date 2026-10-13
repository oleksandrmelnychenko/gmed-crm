$ErrorActionPreference = "Continue"
$root = "C:\Users\oleks\Developer\gmed\services\clinical-document-parser"
@(
  "datasets\de-uk\raw","datasets\de-ru\raw",
  "training\de-uk\scripts","training\de-uk\out",
  "training\de-ru\scripts","training\de-ru\out"
) | ForEach-Object { New-Item -ItemType Directory -Force -Path (Join-Path $root $_) | Out-Null }

$jobs = @(
  @{pair="de-uk"; name="ELRC-5179-acts_Ukrainian"; url="https://object.pouta.csc.fi/OPUS-ELRC-5179-acts_Ukrainian/v1/moses/de-uk.txt.zip"},
  @{pair="de-uk"; name="ELRC-wikipedia_health"; url="https://object.pouta.csc.fi/OPUS-ELRC-wikipedia_health/v1/moses/de-uk.txt.zip"},
  @{pair="de-uk"; name="ELRC-5191-Auslandsgesellschaft"; url="https://object.pouta.csc.fi/OPUS-ELRC-5191-Auslandsgesellschaft/v1/moses/de-uk.txt.zip"},
  @{pair="de-uk"; name="WikiMatrix"; url="https://object.pouta.csc.fi/OPUS-WikiMatrix/v1/moses/de-uk.txt.zip"},
  @{pair="de-uk"; name="TED2020"; url="https://object.pouta.csc.fi/OPUS-TED2020/v1/moses/de-uk.txt.zip"},
  @{pair="de-uk"; name="Tatoeba"; url="https://object.pouta.csc.fi/OPUS-Tatoeba/v2026-07-08/moses/de-uk.txt.zip"},
  @{pair="de-uk"; name="EUbookshop"; url="https://object.pouta.csc.fi/OPUS-EUbookshop/v2/moses/de-uk.txt.zip"},
  @{pair="de-uk"; name="wikimedia"; url="https://object.pouta.csc.fi/OPUS-wikimedia/v20260327/moses/de-uk.txt.zip"},
  @{pair="de-uk"; name="QED"; url="https://object.pouta.csc.fi/OPUS-QED/v2.0a/moses/de-uk.txt.zip"},
  @{pair="de-ru"; name="MultiUN"; url="https://object.pouta.csc.fi/OPUS-MultiUN/v1/moses/de-ru.txt.zip"},
  @{pair="de-ru"; name="News-Commentary"; url="https://object.pouta.csc.fi/OPUS-News-Commentary/v16/moses/de-ru.txt.zip"},
  @{pair="de-ru"; name="WikiMatrix"; url="https://object.pouta.csc.fi/OPUS-WikiMatrix/v1/moses/de-ru.txt.zip"},
  @{pair="de-ru"; name="TED2020"; url="https://object.pouta.csc.fi/OPUS-TED2020/v1/moses/de-ru.txt.zip"},
  @{pair="de-ru"; name="Tatoeba"; url="https://object.pouta.csc.fi/OPUS-Tatoeba/v2026-07-08/moses/de-ru.txt.zip"},
  @{pair="de-ru"; name="ELRC-wikipedia_health"; url="https://object.pouta.csc.fi/OPUS-ELRC-wikipedia_health/v1/moses/de-ru.txt.zip"},
  @{pair="de-ru"; name="ELRC-5067-SciPar"; url="https://object.pouta.csc.fi/OPUS-ELRC-5067-SciPar/v1/moses/de-ru.txt.zip"},
  @{pair="de-ru"; name="EUbookshop"; url="https://object.pouta.csc.fi/OPUS-EUbookshop/v2/moses/de-ru.txt.zip"},
  @{pair="de-ru"; name="WMT-News"; url="https://object.pouta.csc.fi/OPUS-WMT-News/v2019/moses/de-ru.txt.zip"},
  @{pair="de-ru"; name="GlobalVoices"; url="https://object.pouta.csc.fi/OPUS-GlobalVoices/v2018q4/moses/de-ru.txt.zip"},
  @{pair="de-ru"; name="TildeMODEL"; url="https://object.pouta.csc.fi/OPUS-TildeMODEL/v2018/moses/de-ru.txt.zip"},
  @{pair="de-ru"; name="wikimedia"; url="https://object.pouta.csc.fi/OPUS-wikimedia/v20260327/moses/de-ru.txt.zip"},
  @{pair="de-ru"; name="QED"; url="https://object.pouta.csc.fi/OPUS-QED/v2.0a/moses/de-ru.txt.zip"}
)

foreach ($j in $jobs) {
  $dest = Join-Path $root ("datasets\{0}\raw\{1}.zip" -f $j.pair, $j.name)
  if ((Test-Path $dest) -and ((Get-Item $dest).Length -gt 1000)) {
    Write-Output ("SKIP exists {0}/{1} bytes={2}" -f $j.pair, $j.name, (Get-Item $dest).Length)
    continue
  }
  Write-Output ("GET {0}/{1}" -f $j.pair, $j.name)
  & curl.exe -L --fail --retry 3 --retry-delay 2 --connect-timeout 30 -o $dest $j.url
  if ($LASTEXITCODE -ne 0) {
    Write-Output ("FAIL {0} exit={1}" -f $j.name, $LASTEXITCODE)
    if (Test-Path $dest) { Remove-Item $dest -Force }
  } else {
    Write-Output ("OK {0} size={1}" -f $j.name, (Get-Item $dest).Length)
  }
}
Write-Output "=== SUMMARY ==="
Get-ChildItem (Join-Path $root "datasets\de-uk\raw"), (Join-Path $root "datasets\de-ru\raw") |
  Select-Object FullName, Length | Format-Table -AutoSize
