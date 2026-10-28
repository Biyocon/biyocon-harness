# How to Pin Biyocon Harness to Taskbar

Biyocon Harness runs a local web server. The launcher `start-biyocon.bat` in `C:\Users\Biyocon\biyocon-harness` starts it on port 10822 and opens `http://127.0.0.1:10822` in the default browser.

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

When the server is already listening on port 10822, the launcher only opens the browser and does not start a second server.

## Method 2: Pin the Web UI

1. **Start the server**:
   ```cmd
   cd C:\Users\Biyocon\biyocon-harness
   pnpm dsh web --port 10822
   ```

2. **Open `http://127.0.0.1:10822`** in Edge or Chrome.

3. **Pin the site**: use the browser's "Pin to taskbar" or "Install this site as an app" option.

## Method 3: PowerShell Launcher

Create `biyocon-launcher.ps1`, create a shortcut to it, and pin the shortcut:

```powershell
Set-Location "C:\Users\Biyocon\biyocon-harness"
Start-Process -FilePath "pnpm" -ArgumentList "dsh web --port 10822" -WindowStyle Hidden
Start-Sleep -Seconds 3
Start-Process "http://127.0.0.1:10822"
```

## Start on Login

In Task Scheduler, create a basic task that runs at log on with this action:

```
cmd /c "cd C:\Users\Biyocon\biyocon-harness && pnpm dsh web --port 10822"
```

## Troubleshooting

1. Make sure dependencies are installed:
   ```cmd
   cd C:\Users\Biyocon\biyocon-harness
   pnpm install
   ```

2. Check which process listens on port 10822:
   ```cmd
   netstat -ano | findstr /C:":10822 " | findstr LISTENING
   ```

3. If the port is occupied by another program, change `DSH_PORT` in `start-biyocon.bat` and use the same port in any shortcut or bookmark.

Browser settings that the Web UI stores per address, such as theme and language, apply to `http://127.0.0.1:10822` only. Sessions and conversations stay in `C:\Users\Biyocon\.dsh` regardless of the port.
