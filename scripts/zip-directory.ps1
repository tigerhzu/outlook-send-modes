function New-PortableZip {
    param([Parameter(Mandatory=$true)][string]$SourceDirectory, [Parameter(Mandatory=$true)][string]$DestinationPath)
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $sourceRoot = (Resolve-Path -LiteralPath $SourceDirectory).ProviderPath.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    $archiveFile = [IO.Path]::GetFullPath($DestinationPath)
    if ($archiveFile.StartsWith($sourceRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive must be outside its source directory.' }
    $stream = [IO.File]::Open($archiveFile, [IO.FileMode]::Create, [IO.FileAccess]::ReadWrite)
    try {
        $archive = New-Object IO.Compression.ZipArchive($stream, [IO.Compression.ZipArchiveMode]::Create, $true)
        try {
            foreach ($file in (Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force | Sort-Object FullName)) {
                $entryName = $file.FullName.Substring($sourceRoot.Length).Replace('\', '/')
                [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
            }
        } finally { $archive.Dispose() }
    } finally { $stream.Dispose() }
}
