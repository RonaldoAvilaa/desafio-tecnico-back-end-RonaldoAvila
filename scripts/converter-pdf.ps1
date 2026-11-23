# Converte todos os Relatorio_*.docx do projeto em PDF usando o Microsoft Word instalado.
# Rodar:  powershell -ExecutionPolicy Bypass -File .\scripts\converter-pdf.ps1
$ErrorActionPreference = 'Stop'
$raiz = Split-Path $PSScriptRoot -Parent
$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
try {
  Get-ChildItem $raiz -Recurse -Filter 'Relatorio_*.docx' |
    Where-Object { $_.FullName -notmatch '\\(node_modules|entregas)\\' } |
    ForEach-Object {
      $pdf = [IO.Path]::ChangeExtension($_.FullName, '.pdf')
      $doc = $word.Documents.Open($_.FullName, $false, $true)
      $doc.SaveAs2($pdf, 17)   # 17 = wdFormatPDF
      $paginas = $doc.ComputeStatistics(2)  # 2 = wdStatisticPages
      $doc.Close($false)
      "{0,-28} {1,3} paginas" -f (Split-Path $pdf -Leaf), $paginas
    }
} finally {
  $word.Quit()
  [void][Runtime.InteropServices.Marshal]::ReleaseComObject($word)
}
