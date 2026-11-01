# Give the Biyocon Harness shortcuts the Biyocon mark as a white rounded tile,
# which stays visible on a dark taskbar. A shortcut whose target is cmd.exe
# otherwise shows the console icon, and Windows shortcuts accept only .ico files.
#
# Updates every .lnk on the Desktop and among the pinned taskbar items whose
# arguments run start-biyocon.bat. The icon is written outside the repository.
# Windows may keep showing a cached icon until the taskbar item is unpinned and
# pinned again.
param(
    [string]$Source = (Join-Path (Split-Path $PSScriptRoot -Parent) 'apps\web\public\biyocon-brandmark-512.png'),
    [string]$Output = (Join-Path $env:LOCALAPPDATA 'Biyocon\biyocon-white.ico'),
    # Corner radius as a fraction of the icon side; 0 gives square corners.
    [double]$CornerRadius = 0.18,
    # Tile side relative to the mark's bounding box; 1 leaves no margin.
    [double]$Padding = 1.18
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$shell = New-Object -ComObject WScript.Shell
$folders = [Environment]::GetFolderPath('Desktop'), "$env:APPDATA\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"
$links = @(Get-ChildItem $folders -Filter '*.lnk' -ErrorAction SilentlyContinue |
    Where-Object { $shell.CreateShortcut($_.FullName).Arguments -match 'start-biyocon\.bat' })
if ($links.Count -eq 0) {
    throw 'No Desktop or taskbar shortcut runs start-biyocon.bat; create it as described in PIN_TO_TASKBAR_GUIDE.md first.'
}

$img = [System.Drawing.Image]::FromFile($Source)
try {
    # Locate the mark on a small preview, ignoring transparent and near-white pixels.
    $p = 256
    $preview = New-Object System.Drawing.Bitmap $p, $p
    $g = [System.Drawing.Graphics]::FromImage($preview); $g.DrawImage($img, 0, 0, $p, $p); $g.Dispose()
    $minX = $p; $minY = $p; $maxX = -1; $maxY = -1
    for ($y = 0; $y -lt $p; $y++) {
        for ($x = 0; $x -lt $p; $x++) {
            $c = $preview.GetPixel($x, $y)
            if ($c.A -gt 32 -and -not ($c.R -gt 235 -and $c.G -gt 235 -and $c.B -gt 235)) {
                if ($x -lt $minX) { $minX = $x }; if ($x -gt $maxX) { $maxX = $x }
                if ($y -lt $minY) { $minY = $y }; if ($y -gt $maxY) { $maxY = $y }
            }
        }
    }
    $preview.Dispose()
    if ($maxX -lt 0) { throw "No mark found in $Source" }
    $sx = $img.Width / $p; $sy = $img.Height / $p
    $side = [Math]::Max(($maxX - $minX + 1) * $sx, ($maxY - $minY + 1) * $sy) * $Padding
    $cx = ($minX + $maxX + 1) / 2 * $sx; $cy = ($minY + $maxY + 1) / 2 * $sy
    $crop = New-Object System.Drawing.RectangleF ([float]($cx - $side / 2)), ([float]($cy - $side / 2)), ([float]$side), ([float]$side)

    $sizes = 256, 48, 32, 24, 16
    $pngs = foreach ($s in $sizes) {
        $bmp = New-Object System.Drawing.Bitmap $s, $s
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.SmoothingMode = 'AntiAlias'; $g.InterpolationMode = 'HighQualityBicubic'; $g.PixelOffsetMode = 'HighQuality'
        $r = [Math]::Max(1, [int]($s * $CornerRadius)); $d = 2 * $r; $e = $s - 1
        $tile = New-Object System.Drawing.Drawing2D.GraphicsPath
        $tile.AddArc(0, 0, $d, $d, 180, 90); $tile.AddArc($e - $d, 0, $d, $d, 270, 90)
        $tile.AddArc($e - $d, $e - $d, $d, $d, 0, 90); $tile.AddArc(0, $e - $d, $d, $d, 90, 90)
        $tile.CloseFigure()
        $g.FillPath([System.Drawing.Brushes]::White, $tile)
        $tile.Dispose()
        $g.DrawImage($img, (New-Object System.Drawing.RectangleF 0, 0, $s, $s), $crop, [System.Drawing.GraphicsUnit]::Pixel)
        $g.Dispose()
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
        , $ms.ToArray()
    }
} finally {
    $img.Dispose()
}

# ICO container with PNG-compressed entries; a width/height byte of 0 means 256.
New-Item -ItemType Directory -Force -Path (Split-Path $Output -Parent) | Out-Null
$w = New-Object System.IO.BinaryWriter ([System.IO.File]::Create($Output))
try {
    $w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $b = if ($sizes[$i] -ge 256) { 0 } else { $sizes[$i] }
        $w.Write([byte]$b); $w.Write([byte]$b); $w.Write([byte]0); $w.Write([byte]0)
        $w.Write([UInt16]1); $w.Write([UInt16]32)
        $w.Write([UInt32]$pngs[$i].Length); $w.Write([UInt32]$offset)
        $offset += $pngs[$i].Length
    }
    foreach ($bytes in $pngs) { $w.Write($bytes) }
} finally {
    $w.Close()
}
"Icon written: $Output"

foreach ($l in $links) {
    $link = $shell.CreateShortcut($l.FullName); $link.IconLocation = "$Output,0"; $link.Save()
    "Updated: $($l.FullName)"
}
ie4uinit.exe -show
