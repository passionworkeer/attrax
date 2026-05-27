$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")
node scripts/preflight-deploy.mjs
