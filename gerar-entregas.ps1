# Gera um .zip por atividade na pasta "entregas", pronto para anexar no Teams.
# Rodar:  powershell -ExecutionPolicy Bypass -File .\gerar-entregas.ps1
$ErrorActionPreference = 'Stop'
$raiz = $PSScriptRoot
$saida = Join-Path $raiz 'entregas'
$tmp = Join-Path $raiz '.entregas-tmp'

# atividade => pastas que vão no zip (a primeira é a principal)
$atividades = [ordered]@{
  'Parte1'  = @('parte1')
  'Parte2'  = @('parte2', 'parte1')
  'Parte3'  = @('parte3', 'parte2')
  'Parte4'  = @('parte4')
  'Tarefa1' = @('tarefa1')
  'Tarefa2' = @('tarefa2')
  'Tarefa3' = @('tarefa3')
  'Tarefa4' = @('tarefa4')
}
$comuns = @('package.json', 'package-lock.json', '.env.example', 'README.md')

Remove-Item $saida, $tmp -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory $saida | Out-Null

foreach ($nome in $atividades.Keys) {
  $dest = Join-Path $tmp $nome
  New-Item -ItemType Directory $dest | Out-Null
  foreach ($pasta in $atividades[$nome]) { Copy-Item (Join-Path $raiz $pasta) $dest -Recurse }
  foreach ($arq in $comuns) { Copy-Item (Join-Path $raiz $arq) $dest }
  $zip = Join-Path $saida "MongoDB_$nome.zip"
  Compress-Archive -Path (Join-Path $dest '*') -DestinationPath $zip
  "{0,-22} {1,8:N0} bytes" -f (Split-Path $zip -Leaf), (Get-Item $zip).Length
}
Remove-Item $tmp -Recurse -Force
