# Development Environment Setup

## ✨ Cross-Platform Support

This setup script works seamlessly on **Windows, macOS, and Linux** without any OS-specific modifications!

## Quick Start

To start the complete development environment with all services, simply run:

```bash
npm run goodfellow:dev
```

or using bun:

```bash
bun goodfellow:dev
```

## Development Script Options

Choose the development mode that best fits your needs:

### 🌐 With Cloudflare Tunnel (Default)
```bash
npm run goodfellow:dev
# or: bun goodfellow:dev
```
- Creates a public tunnel using Cloudflare (requires `cloudflared` installed)
- Best for production-like testing and external access
- R2_PUBLIC_URL will be set to a public tunnel URL

### 🔗 With LocalTunnel
```bash
npm run goodfellow:dev:localtunnel
# or: bun goodfellow:dev:localtunnel
```
- Creates a public tunnel using localtunnel.me service
- No additional installation required
- Good alternative if cloudflared is not available

### 🏠 Localhost Only
```bash
npm run goodfellow:dev:localhost
# or: bun goodfellow:dev:localhost
```
- **NEW**: Forces localhost-only development (no tunnel creation)
- Fastest startup time (skips tunnel creation)
- R2_PUBLIC_URL will be set to `http://localhost:PORT`
- Perfect for pure local development

## What It Does

The `goodfellow:dev` script orchestrates the complete development setup automatically:

1. **✅ D1 Database Check**: Verifies if D1 tables exist, creates them if not
2. **🚀 R2 Server**: Starts the R2 development server on port 34381
3. **🌐 Cloudflare Tunnel** (Optional): Creates a public tunnel for the R2 server if `cloudflared` is available
4. **📝 Environment Variables**: Updates `.dev.vars` with the tunnel URL (or localhost if no tunnel)
5. **✨ Goodfellow Server**: Starts the main development server

## Prerequisites

### Required
- Node.js or Bun
- Wrangler CLI (installed via npm dependencies)
- Cloudflare account with appropriate permissions

### Optional: Cloudflare Tunnel (`cloudflared`)

**Important**: The script will work perfectly fine without `cloudflared` installed! 

- **With cloudflared**: Creates a public tunnel URL for accessing R2 server remotely
- **Without cloudflared**: Uses localhost URL for local development only

If you want to enable the public tunnel feature, install `cloudflared`:

**Windows:**
```bash
winget install cloudflare.cloudflared
```
Or download from: https://github.com/cloudflare/cloudflared/releases/latest

**macOS:**
```bash
brew install cloudflared
```

**Linux:**
```bash
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
chmod +x cloudflared-linux-amd64
sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared
```

The script will automatically detect if `cloudflared` is installed and provide installation instructions if needed.

## Manual Setup (if needed)

If you prefer to run services individually:

```bash
# 1. Setup D1 tables
bun d1:setup:dev

# 2. Start R2 server (in separate terminal)
bun r2:dev

# 3. Create tunnel (in separate terminal)
cloudflared tunnel --url http://localhost:34381

# 4. Manually update .dev.vars with tunnel URL
echo "R2_PUBLIC_URL=https://your-tunnel-url.trycloudflare.com" >> .dev.vars

# 5. Start Goodfellow server
wrangler dev --config wrangler.jsonc --env development
```

## Troubleshooting

### Tunnel Creation Fails or Skipped
- **Don't worry!** The script will continue working with localhost URLs if `cloudflared` is not available
- If you want tunnel functionality:
  - Ensure `cloudflared` is installed and in your PATH
  - Check your internet connection
  - Verify Cloudflare Tunnel service is accessible

### Port Already in Use
The R2 server uses port 34381 by default. If you see a port conflict:

**Windows:**
```bash
netstat -ano | findstr :34381
taskkill /PID <PID> /F
```

**macOS/Linux:**
```bash
lsof -i :34381
kill -9 $(lsof -t -i:34381)
```

### D1 Tables Not Creating
- Check your Wrangler authentication: `wrangler whoami`
- Verify the database schema file exists: `database/schema-d1.sql`

### Process Cleanup
The script handles cleanup automatically on exit (Ctrl+C), but if processes remain:

**Windows:**
```bash
taskkill /F /IM wrangler.exe
taskkill /F /IM cloudflared.exe
```

**macOS/Linux:**
```bash
pkill -f wrangler
pkill -f cloudflared
```

## Environment Variables

After the setup completes, your `.dev.vars` file will contain:

**With cloudflared installed:**
```
R2_PUBLIC_URL=https://[random-id].trycloudflare.com
```

**Without cloudflared:**
```
R2_PUBLIC_URL=http://localhost:34381
```

This URL is used by the application to access R2 resources during development.

## Development Workflow

1. Run `bun goodfellow:dev` once to start all services
2. All processes run together - stopping one (Ctrl+C) stops all
3. Services auto-reload on code changes (where supported)
4. Logs from all services appear in the same terminal

## Notes

- ✅ **Cross-platform**: Works on Windows, macOS, and Linux without modifications
- 🔧 **Flexible**: Works with or without cloudflared tunnel
- 🔄 **Auto-updating**: The `.dev.vars` file is automatically updated with the appropriate URL
- 🧹 **Clean**: All background processes are cleaned up when you stop the script
- ⚡ **Simple**: You only need to run one command to get the full development environment
- 🌐 **Tunnel URL**: Changes each time you restart (if using cloudflared)

