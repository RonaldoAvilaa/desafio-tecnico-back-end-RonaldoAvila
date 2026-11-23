# Executa um script da atividade num terminal visível (usado para os prints dos relatórios).
param([string]$Titulo, [string]$Comando)
Set-Location (Split-Path $PSScriptRoot -Parent)
$Host.UI.RawUI.WindowTitle = $Titulo
Write-Host "PS $PWD> $Comando" -ForegroundColor Yellow
Invoke-Expression $Comando
