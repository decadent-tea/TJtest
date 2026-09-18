param([Parameter(Mandatory=$true)][string]$DocumentPath, [string]$PdfPath)
$ErrorActionPreference = 'Stop'
$taskWord = $null
$taskDocument = $null
try {
  $taskWord = New-Object -ComObject Word.Application
  $taskWord.Visible = $false
  $taskWord.DisplayAlerts = 0
  $taskDocument = $taskWord.Documents.Open($DocumentPath, $false, $false)
  # Word regenerates TOC1/2/3 on field update. Configure these built-in styles
  # explicitly, otherwise it replaces the template's Song font and dot tabs.
  for ($taskLevel = 0; $taskLevel -lt 3; $taskLevel++) {
    $taskStyle = $taskDocument.Styles.Item(-20 - $taskLevel)
    $taskStyle.Font.Name = '宋体'
    $taskStyle.Font.NameFarEast = '宋体'
    $taskStyle.Font.Size = 14
    $taskStyle.Font.Color = 0
    $taskStyle.ParagraphFormat.SpaceBefore = 0
    $taskStyle.ParagraphFormat.SpaceAfter = 0
    $taskStyle.ParagraphFormat.LineSpacingRule = 4
    $taskStyle.ParagraphFormat.LineSpacing = 28
    $taskStyle.ParagraphFormat.LeftIndent = 0
    $taskStyle.ParagraphFormat.FirstLineIndent = 28 * $taskLevel
    $taskStyle.ParagraphFormat.TabStops.ClearAll()
    $taskStyle.ParagraphFormat.TabStops.Add(425.2, 2, 1) | Out-Null
  }
  $taskDocument.Repaginate()
  foreach ($taskToc in $taskDocument.TablesOfContents) { $taskToc.Update() }
  $taskDocument.Fields.Update() | Out-Null
  foreach ($taskStory in $taskDocument.StoryRanges) {
    $taskStory.Font.Name = '宋体'
    $taskStory.Font.NameFarEast = '宋体'
    $taskStory.Font.Color = 0
  }
  foreach ($taskToc in $taskDocument.TablesOfContents) {
    $taskToc.Range.Font.Size = 14
    foreach ($taskParagraph in $taskToc.Range.Paragraphs) {
      $taskParagraph.TabStops.ClearAll()
      $taskParagraph.TabStops.Add(425.2, 2, 1) | Out-Null
    }
  }
  $taskDocument.Repaginate()
  foreach ($taskToc in $taskDocument.TablesOfContents) { $taskToc.UpdatePageNumbers() }
  $taskDocument.Save()
  if ($PdfPath) { $taskDocument.ExportAsFixedFormat($PdfPath, 17) }
} finally {
  if ($taskDocument) { $taskDocument.Close(0); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($taskDocument) | Out-Null }
  if ($taskWord) { $taskWord.Quit(); [System.Runtime.InteropServices.Marshal]::ReleaseComObject($taskWord) | Out-Null }
}
