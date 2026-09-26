param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Add', 'Remove')]
    [string]$Action,

    [Parameter(Mandatory = $true)]
    [string]$CliDirectory
)

$ErrorActionPreference = 'Stop'
$directory = [System.IO.Path]::GetFullPath($CliDirectory).TrimEnd('\')
if ($Action -eq 'Add') {
    if (-not (Test-Path -LiteralPath (Join-Path $directory 'deskoy.cmd') -PathType Leaf) -or
        -not (Test-Path -LiteralPath (Join-Path $directory 'target\release\deskoy.exe') -PathType Leaf)) {
        throw 'The Deskoy CLI files are missing from the installer.'
    }
}

$current = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @($current -split ';')
$matches = @($entries | Where-Object { $_.TrimEnd('\') -ieq $directory })
if ($Action -eq 'Add' -and $matches.Count -eq 0) {
    $separator = if ($current -and -not $current.EndsWith(';')) { ';' } else { '' }
    [Environment]::SetEnvironmentVariable('Path', ($current + $separator + $directory), 'User')
} elseif ($Action -eq 'Remove' -and $matches.Count -gt 0) {
    $remaining = @($entries | Where-Object { $_.TrimEnd('\') -ine $directory })
    [Environment]::SetEnvironmentVariable('Path', ($remaining -join ';'), 'User')
}
