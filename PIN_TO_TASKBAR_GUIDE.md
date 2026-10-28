# How to Pin Biyocon Harness to Taskbar

Biyocon Harness runs a local web server. The launcher `start-biyocon.bat` in `C:\Users\Biyocon\biyocon-harness` runs `start-biyocon.ps1`, which starts the server on port 10822 and opens `http://127.0.0.1:10822` in the default browser.

Run only one Biyocon Harness server at a time. Every launch method below stores sessions in the same `DSH_HOME` (by default `%USERPROFILE%\.dsh`), and two servers writing the same sessions can overwrite each other's data. The launcher refuses to start a second server; the manual command in Method 2 does not check.

## Method 1: Pin the Launcher

1. **Create a Shortcut to the Launcher**:
   - Right-click on your Desktop or in a folder
   - Select "New" → "Shortcut"
   - Enter the path: `C:\Users\Biyocon\biyocon-harness\start-biyocon.bat`
   - Click "Next" and name it "Biyocon Harness"
   - Click "Finish"

2. **Pin to Taskbar**:
   - Right-click on the new shortcut
   - Select "Pin to Taskbar"

The launcher handles these cases:

- **Server already running on port 10822:** it opens the browser and does not start a second server.
- **Another program holds port 10822:** it reports that program's PID and opens nothing.
- **A Biyocon Harness server runs on another port:** it reports that server's PID and port and starts nothing. Stop that server first.
- **Another launcher is still starting the server:** it reports that and starts nothing.
- **Cold start:** it starts the server in a "Biyocon Server" window and opens the browser once the server listens, waiting up to `$StartTimeoutSeconds` seconds. If the server fails, the Biyocon Server window stays open with the error.

A Biyocon Harness server is recognised as a `node.exe` process whose command line runs the `dsh` CLI entry (`bin.ts` or `bin.js`) with the `web` command.

## Method 2: Pin the Web UI

1. **Start the server** without the launcher's checks:
   ```cmd
   cd C:\Users\Biyocon\biyocon-harness
   pnpm dsh web --port 10822
   ```

2. **Open `http://127.0.0.1:10822`** in Edge or Chrome.

3. **Pin the site**: use the browser's "Pin to taskbar" or "Install this site as an app" option.

## Start on Login

Press Win+R, run `shell:startup`, and place a shortcut to `C:\Users\Biyocon\biyocon-harness\start-biyocon.bat` in the folder that opens. The launcher's checks then apply at every login.

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
