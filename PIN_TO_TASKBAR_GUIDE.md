# How to Pin Biyocon Harness to Taskbar

Biyocon Harness runs a local web server. The launcher `start-biyocon.bat` in `C:\Users\Biyocon\biyocon-harness` runs `start-biyocon.ps1`, which starts the server on port 10822 and opens `http://127.0.0.1:10822` in the default browser.

Run only one Biyocon Harness server at a time. Every launch method below stores sessions in the same `DSH_HOME` (by default `%USERPROFILE%\.dsh`), and two servers writing the same sessions can overwrite each other's data. The launcher refuses to start a second server; the manual command in Method 2 does not check.

## Method 1: Pin the Launcher

Windows 11 does not offer "Pin to taskbar" for a `.bat` file, so the shortcut runs the launcher through `cmd.exe`.

1. **Create a Shortcut to the Launcher**:
   - Right-click on your Desktop and select "New" → "Shortcut"
   - Enter the location: `C:\Windows\System32\cmd.exe /c "C:\Users\Biyocon\biyocon-harness\start-biyocon.bat"`
   - Click "Next", name it "Biyocon Harness", and click "Finish"

2. **Set the Biyocon icon** (optional): without it, the shortcut shows the `cmd.exe` console icon. In PowerShell, run:
   ```powershell
   cd C:\Users\Biyocon\biyocon-harness
   powershell -ExecutionPolicy Bypass -File scripts\set-biyocon-shortcut-icon.ps1
   ```
   The script draws `apps/web/public/biyocon-brandmark-512.png` on a white rounded tile, writes `%LOCALAPPDATA%\Biyocon\biyocon-white.ico`, and sets it on every Desktop and pinned taskbar shortcut that runs `start-biyocon.bat`. It fails if no such shortcut exists. `-Source` selects another image, `-CornerRadius 0` gives square corners, and `-Padding` sets the margin around the mark. Run it again after pinning to update the pinned copy.

3. **Pin to Taskbar**:
   - Right-click on the shortcut on the Desktop
   - Select "Show more options" → "Pin to taskbar", or drag the shortcut onto the taskbar
   - If the taskbar keeps showing an earlier icon, select "Unpin from taskbar" and pin the Desktop shortcut again; Windows caches pinned icons

The launcher handles these cases:

- **Server already running on port 10822:** it opens the browser and does not start a second server, provided no other Biyocon Harness server is running.
- **Another program holds port 10822:** it reports that program's PID and opens nothing.
- **A Biyocon Harness server runs on another port:** it reports that server's PID and port and opens nothing, even when a server also listens on port 10822. Stop that other server first.
- **Another launcher is still starting the server:** it reports that and starts nothing.
- **Cold start:** it starts the server in a "Biyocon Server" window and opens the browser once the server listens, waiting up to `$StartTimeoutSeconds` seconds. If the server fails, the Biyocon Server window stays open with the error.

A Biyocon Harness server is recognised as a `node.exe` process whose command line runs a `dsh` CLI entry (`apps/cli/scripts/source-launch.ts` from `pnpm dsh`, an earlier `bin.ts` source launch, or the built `bin.js`) with the `web` command, including the quoted `"web"` argument emitted by `pnpm dsh web`.

## Method 2: Pin the Web UI

1. **Start the server** without the launcher's checks:
   ```cmd
   cd C:\Users\Biyocon\biyocon-harness
   pnpm dsh web --port 10822
   ```

2. **Open `http://127.0.0.1:10822`** in Edge or Chrome.

3. **Pin the site**: use the browser's "Pin to taskbar" or "Install this site as an app" option.

## Start on Login

Press Win+R, run `shell:startup`, and copy the Desktop shortcut from Method 1 into the folder that opens. The launcher's checks then apply at every login.

## Troubleshooting

1. Make sure dependencies are installed:
   ```cmd
   cd C:\Users\Biyocon\biyocon-harness
   pnpm install
   ```

2. Check which process listens on port 10822:
   ```powershell
   Get-NetTCPConnection -LocalPort 10822 -State Listen
   ```

3. If the launcher reports that another program uses the port, change `$Port` in `start-biyocon.ps1` and use the same port in any bookmark.

Browser settings that the Web UI stores per address, such as theme and language, apply to `http://127.0.0.1:10822` only. Sessions and conversations stay in `DSH_HOME` regardless of the port.
