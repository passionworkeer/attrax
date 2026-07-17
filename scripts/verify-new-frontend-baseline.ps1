param(
  [Parameter(Mandatory = $true)]
  [string]$Original,

  [Parameter(Mandatory = $true)]
  [string]$Integrated
)

$ErrorActionPreference = "Stop"
$protectedFiles = @(
  "app/page.tsx",
  "app/globals.css",
  "components/complipilot/homepage.tsx"
)

function Get-NormalizedHash([string]$Path) {
  $content = (Get-Content -LiteralPath $Path -Raw -Encoding utf8) -replace "`r`n", "`n"
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($content)
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    return [BitConverter]::ToString($sha256.ComputeHash($bytes)).Replace("-", "")
  }
  finally {
    $sha256.Dispose()
  }
}

foreach ($relativePath in $protectedFiles) {
  $originalPath = Join-Path $Original $relativePath
  $integratedPath = Join-Path $Integrated $relativePath
  $originalHash = Get-NormalizedHash $originalPath
  $integratedHash = Get-NormalizedHash $integratedPath

  if ($originalHash -ne $integratedHash) {
    throw "Protected frontend drift: $relativePath"
  }
}

Write-Output "Approved frontend baseline verified ($($protectedFiles.Count) protected files)."
