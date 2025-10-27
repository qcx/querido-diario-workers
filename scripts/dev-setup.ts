#!/usr/bin/env node
/**
 * Development Setup Script
 * 
 * This script orchestrates the complete development environment setup:
 * 1. Checks and sets up D1 tables if needed
 * 2. Starts R2 dev server and detects the port Wrangler assigns
 * 3. Health checks R2 server to ensure it's fully ready
 * 4. Creates tunnel for R2 server (Cloudflare or LocalTunnel)
 * 5. Updates .dev.vars with tunnel URL (or localhost with detected port)
 * 6. Starts the main Goodfellow dev server
 * 
 * ═══════════════════════════════════════════════════════════════════
 * TUNNEL OPTIONS
 * ═══════════════════════════════════════════════════════════════════
 * 
 * • --cloudflare: Uses Cloudflare Tunnel (default, production-grade)
 *   - Requires 'cloudflared' to be installed
 *   - More reliable and faster than localtunnel
 *   - Better for production-like testing
 * 
 * • --localtunnel: Uses localtunnel.me (alternative)
 *   - No installation required (npm dependency)
 *   - Good for quick testing
 *   - May be less stable
 * 
 * • --localhost: Forces localhost-only development (no tunnel)
 *   - R2_PUBLIC_URL will be set to http://localhost:PORT
 *   - Useful for pure local development without external access
 *   - Faster startup (no tunnel creation time)
 * 
 * ═══════════════════════════════════════════════════════════════════
 * DYNAMIC PORT DETECTION
 * ═══════════════════════════════════════════════════════════════════
 * 
 * The script automatically detects the port that Wrangler assigns to the R2
 * dev server by parsing its output. This ensures the tunnel always points to
 * the correct port, regardless of what Wrangler chooses.
 * 
 * ═══════════════════════════════════════════════════════════════════
 * CROSS-PLATFORM COMPATIBILITY
 * ═══════════════════════════════════════════════════════════════════
 * 
 * This script works on Windows, macOS, and Linux:
 * 
 * • Wrangler commands: Uses 'wrangler.cmd' on Windows, 'wrangler' on Unix
 * • Process spawning: Uses shell mode for better cross-platform command execution
 * • Tunneling: Supports both Cloudflare and LocalTunnel
 * • File paths: Uses Node.js path utilities for proper path handling
 * 
 * The script will work even if the tunnel fails to create, falling back
 * to localhost URLs for local development.
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import localtunnel from 'localtunnel';

// Parse command line arguments
const args = process.argv.slice(2);
const FORCE_LOCALHOST = args.includes('--localhost');
const USE_CLOUDFLARE = args.includes('--cloudflare') || (!args.includes('--localtunnel') && !FORCE_LOCALHOST);
const USE_LOCALTUNNEL = args.includes('--localtunnel');
const TUNNEL_TYPE = USE_CLOUDFLARE ? 'cloudflare' : 'localtunnel';

const ROOT_DIR = process.cwd();
const DEV_VARS_PATH = join(ROOT_DIR, '.dev.vars');
const IS_WINDOWS = process.platform === 'win32';

interface ProcessManager {
  r2Server?: ChildProcess;
  tunnel?: any; // localtunnel or cloudflared instance
  goodfellow?: ChildProcess;
}

const processes: ProcessManager = {};
let R2_PORT: number | null = null; // Will be set dynamically from Wrangler output
let isCleaningUp = false; // Guard to prevent multiple cleanup executions

/**
 * Check if cloudflared is installed
 */
function checkCloudflared(): boolean {
  try {
    execSync('cloudflared --version', { 
      stdio: 'pipe',
      encoding: 'utf-8'
    });
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Show cloudflared installation instructions
 */
function showCloudflaredInstructions(): void {
  console.log('');
  console.log('❌ Cloudflare Tunnel requires "cloudflared" to be installed');
  console.log('');
  console.log('📦 Installation instructions:');
  console.log('');
  
  if (IS_WINDOWS) {
    console.log('Windows (using winget):');
    console.log('  winget install --id Cloudflare.cloudflared');
    console.log('');
    console.log('Windows (using Chocolatey):');
    console.log('  choco install cloudflared');
  } else if (process.platform === 'darwin') {
    console.log('macOS (using Homebrew):');
    console.log('  brew install cloudflare/cloudflare/cloudflared');
  } else {
    console.log('Linux (Debian/Ubuntu):');
    console.log('  wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb');
    console.log('  sudo dpkg -i cloudflared-linux-amd64.deb');
    console.log('');
    console.log('Linux (using package manager):');
    console.log('  # Add cloudflare gpg key');
    console.log('  sudo mkdir -p --mode=0755 /usr/share/keyrings');
    console.log('  curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null');
    console.log('  # Add this repo to your apt repositories');
    console.log('  echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list');
    console.log('  # Install cloudflared');
    console.log('  sudo apt-get update && sudo apt-get install cloudflared');
  }
  
  console.log('');
  console.log('📚 More info: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/');
  console.log('');
  console.log('💡 Alternatives:');
  console.log('   • npm run goodfellow:dev:localtunnel (uses localtunnel instead)');
  console.log('   • npm run goodfellow:dev:localhost (localhost-only, no tunnel)');
  console.log('');
}

// Cleanup function to kill all spawned processes (idempotent)
function cleanup(shouldExit: boolean = true) {
  // Guard against multiple cleanup executions
  if (isCleaningUp) {
    return;
  }
  isCleaningUp = true;
  
  console.log('\n🧹 Cleaning up processes...');
  
  if (processes.goodfellow) {
    try {
      processes.goodfellow.kill();
      processes.goodfellow = undefined;
    } catch (error) {
      // Process might already be dead
    }
  }
  
  if (processes.tunnel) {
    try {
      // Handle both localtunnel (has .close()) and cloudflared (ChildProcess, has .kill())
      if (typeof processes.tunnel.close === 'function') {
        processes.tunnel.close();
      } else if (typeof processes.tunnel.kill === 'function') {
        processes.tunnel.kill();
      }
      processes.tunnel = undefined;
    } catch (error) {
      // Process might already be dead
    }
  }
  
  if (processes.r2Server) {
    try {
      processes.r2Server.kill();
      processes.r2Server = undefined;
    } catch (error) {
      // Process might already be dead
    }
  }
  
  // Only exit if explicitly requested (not when called from exit handler)
  if (shouldExit) {
    process.exit(0);
  }
}

// Register cleanup handlers
process.on('SIGINT', () => cleanup(true));   // User pressed Ctrl+C - cleanup and exit
process.on('SIGTERM', () => cleanup(true));  // Process termination - cleanup and exit
process.on('exit', () => cleanup(false));    // Process is already exiting - cleanup only (no exit call)

/**
 * Execute a command and return output (cross-platform)
 */
function execCommand(command: string, args?: string[]): string {
  try {
    const cmd = args ? command : (IS_WINDOWS ? command : command);
    const cmdArgs = args || [];
    
    // If no args provided, parse command string
    if (!args) {
      return execSync(command, { 
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      } as any);
    }
    
    return execSync(`${cmd} ${cmdArgs.join(' ')}`, { 
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    } as any);
  } catch (error: any) {
    return error.stdout || '';
  }
}

/**
 * Check if D1 tables exist (cross-platform)
 */
function checkD1Tables(): boolean {
  console.log('📊 Checking D1 tables...');
  
  try {
    // Use single quotes for better cross-platform compatibility
    const wranglerCmd = IS_WINDOWS ? 'wrangler.cmd' : 'wrangler';
    const output = execSync(
      `${wranglerCmd} d1 execute goodfellow-prod --local --command="SELECT name FROM sqlite_master WHERE type='table'"`,
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe']
      } as any
    );
    
    // Check if we have tables (excluding sqlite internal tables)
    const hasTables = output.includes('crawl_jobs');
    
    if (hasTables) {
      console.log('✅ D1 tables already exist');
      return true;
    } else {
      console.log('❌ D1 tables not found');
      return false;
    }
  } catch (error) {
    console.log('❌ Error checking D1 tables');
    return false;
  }
}

/**
 * Setup D1 tables (cross-platform)
 */
function setupD1Tables(): void {
  console.log('🔧 Setting up D1 tables...');
  
  try {
    const wranglerCmd = IS_WINDOWS ? 'wrangler.cmd' : 'wrangler';
    execSync(
      `${wranglerCmd} d1 execute goodfellow-prod --local --file=database/schema-lite.sql`,
      {
        stdio: 'inherit'
      } as any
    );
    
    console.log('✅ D1 tables created successfully');
  } catch (error) {
    console.error('❌ Failed to create D1 tables');
    throw error;
  }
}

/**
 * Check if R2 server is actually responding to requests
 */
async function healthCheckR2Server(port: number, maxAttempts = 10): Promise<boolean> {
  console.log('🏥 Health checking R2 server...');
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(`http://localhost:${port}/health`).catch(() => null);
      
      // Even if health endpoint doesn't exist, a connection means server is up
      if (response) {
        console.log(`✅ R2 server is responding (attempt ${attempt}/${maxAttempts})`);
        return true;
      }
    } catch (error) {
      // Connection refused means server not ready yet
    }
    
    console.log(`   Waiting for R2 server... (attempt ${attempt}/${maxAttempts})`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  console.log('⚠️  R2 server health check timed out, but continuing...');
  return false;
}

/**
 * Start R2 dev server (cross-platform)
 */
async function startR2Server(): Promise<number> {
  return new Promise((resolve, reject) => {
    console.log(`🚀 Starting R2 dev server...`);
    
    // On Windows, we might need to use wrangler.cmd
    const wranglerCmd = IS_WINDOWS ? 'wrangler.cmd' : 'wrangler';
    
    const r2Process = spawn(
      wranglerCmd,
      ['dev', '--config', 'wrangler-r2.jsonc', '--env', 'development'],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        shell: true // Use shell for better cross-platform compatibility
      }
    );
    
    processes.r2Server = r2Process;
    
    let output = '';
    let resolved = false;
    
    r2Process.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      process.stdout.write(`R2: ${text}`);
      
      // Extract port from Wrangler output
      // Look for patterns like "Ready on http://localhost:8787" or "http://localhost:8787"
      const portMatch = text.match(/http:\/\/localhost:(\d+)/);
      
      if (!resolved && portMatch) {
        const detectedPort = parseInt(portMatch[1], 10);
        R2_PORT = detectedPort;
        console.log(`✅ R2 dev server ready on port ${detectedPort}`);
        resolved = true;
        resolve(detectedPort);
      }
    });
    
    r2Process.stderr?.on('data', (data) => {
      const text = data.toString();
      process.stderr.write(`R2: ${text}`);
      
      // Sometimes Wrangler outputs to stderr, check there too
      const portMatch = text.match(/http:\/\/localhost:(\d+)/);
      
      if (!resolved && portMatch) {
        const detectedPort = parseInt(portMatch[1], 10);
        R2_PORT = detectedPort;
        console.log(`✅ R2 dev server ready on port ${detectedPort}`);
        resolved = true;
        resolve(detectedPort);
      }
    });
    
    r2Process.on('error', (error) => {
      console.error('❌ Failed to start R2 server:', error);
      if (!resolved) {
        reject(error);
      }
    });
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (!resolved) {
        console.log('⚠️  R2 server startup timeout - could not detect port');
        reject(new Error('Could not detect R2 server port'));
      }
    }, 30000);
  });
}

/**
 * Create Cloudflare Tunnel
 */
async function createCloudflareTunnel(port: number): Promise<string | null> {
  console.log(`🌐 Creating Cloudflare Tunnel for R2 server on port ${port}...`);
  
  return new Promise((resolve) => {
    const cloudflaredProcess = spawn(
      'cloudflared',
      ['tunnel', '--url', `http://localhost:${port}`],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        shell: true
      }
    );
    
    processes.tunnel = cloudflaredProcess;
    
    let tunnelUrl: string | null = null;
    let resolved = false;
    
    // Parse stdout for tunnel URL
    cloudflaredProcess.stdout?.on('data', (data) => {
      const text = data.toString();
      process.stdout.write(`Cloudflare: ${text}`);
      
      // Look for the tunnel URL in output
      // Format: https://random-name.trycloudflare.com
      const urlMatch = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      
      if (!resolved && urlMatch) {
        tunnelUrl = urlMatch[0];
        console.log(`✅ Cloudflare Tunnel created: ${tunnelUrl}`);
        resolved = true;
        resolve(tunnelUrl);
      }
    });
    
    cloudflaredProcess.stderr?.on('data', (data) => {
      const text = data.toString();
      // Cloudflare outputs to stderr, check there too
      const urlMatch = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      
      if (!resolved && urlMatch) {
        tunnelUrl = urlMatch[0];
        console.log(`✅ Cloudflare Tunnel created: ${tunnelUrl}`);
        resolved = true;
        resolve(tunnelUrl);
      }
    });
    
    cloudflaredProcess.on('error', (error) => {
      console.error('⚠️  Failed to start Cloudflare Tunnel:', error);
      console.log('⏭️  Falling back to localhost for R2_PUBLIC_URL...');
      if (!resolved) {
        resolved = true;
        resolve(null);
      }
    });
    
    cloudflaredProcess.on('exit', (code) => {
      console.log(`Cloudflare Tunnel exited with code ${code}`);
      if (!resolved) {
        console.log('⏭️  Falling back to localhost for R2_PUBLIC_URL...');
        resolved = true;
        resolve(null);
      }
    });
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (!resolved) {
        console.log('⚠️  Cloudflare Tunnel startup timeout');
        console.log('⏭️  Falling back to localhost for R2_PUBLIC_URL...');
        resolved = true;
        resolve(null);
      }
    }, 30000);
  });
}

/**
 * Create localtunnel
 */
async function createLocalTunnel(port: number): Promise<string | null> {
  console.log(`🌐 Creating localtunnel for R2 server on port ${port}...`);
  
  try {
    const tunnel = await localtunnel({ 
      port: port,
      local_host: 'localhost',
      // Request a subdomain for more stable URLs (optional)
      // subdomain: 'querido-diario-r2' 
    });
    
    processes.tunnel = tunnel;
    
    console.log(`✅ Tunnel created: ${tunnel.url}`);
    console.log('');
    console.log('🔍 Testing tunnel connection...');
    
    // Wait a moment for tunnel to fully establish
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test if tunnel can reach our R2 server
    try {
      const testResponse = await fetch(`${tunnel.url}/health`, {
        signal: AbortSignal.timeout(5000)
      }).catch(() => null);
      
      if (testResponse) {
        console.log('✅ Tunnel is successfully connected to R2 server');
      } else {
        console.log('⚠️  Tunnel created but connection test failed');
        console.log('   This might be a temporary issue with localtunnel.me service');
      }
    } catch (testError) {
      console.log('⚠️  Could not verify tunnel connection');
    }
    
    // Handle tunnel close events
    tunnel.on('close', () => {
      console.log('⚠️  Tunnel closed unexpectedly - you may need to restart');
    });
    
    tunnel.on('error', (err) => {
      console.error('⚠️  Tunnel error:', err);
    });
    
    return tunnel.url;
  } catch (error) {
    console.error('⚠️  Failed to create tunnel:', error);
    console.log('⏭️  Continuing without tunnel (using localhost)...');
    console.log('');
    console.log('💡 Troubleshooting tips:');
    console.log('   • The localtunnel.me service might be temporarily down');
    console.log(`   • Check if port ${port} is accessible locally`);
    console.log('   • Try running the script again in a few moments');
    console.log('   • You can still use localhost for local development');
    return null;
  }
}

/**
 * Create tunnel (Cloudflare or LocalTunnel based on flag)
 */
async function createTunnel(port: number): Promise<string | null> {
  // Skip tunnel creation if --localhost flag is used
  if (FORCE_LOCALHOST) {
    console.log('🏠 --localhost flag detected, skipping tunnel creation');
    console.log('   R2_PUBLIC_URL will be set to localhost for local-only development');
    return null;
  }

  if (USE_CLOUDFLARE) {
    // Check if cloudflared is installed
    if (!checkCloudflared()) {
      showCloudflaredInstructions();
      console.log('⏭️  Continuing without tunnel (using localhost)...');
      return null;
    }
    return await createCloudflareTunnel(port);
  } else {
    return await createLocalTunnel(port);
  }
}

/**
 * Update .dev.vars file with tunnel URL or localhost
 */
function updateDevVars(tunnelUrl: string | null, port: number): void {
  console.log('📝 Updating .dev.vars...');
  
  // Use tunnel URL if available, otherwise use localhost
  const r2Url = tunnelUrl || `http://localhost:${port}`;
  
  const DEV_VARS_EXAMPLE_PATH = join(ROOT_DIR, '.dev.vars.example');
  let content = '';
  let isNewFile = false;
  
  // Check if .dev.vars exists
  if (existsSync(DEV_VARS_PATH)) {
    // Read existing .dev.vars and preserve all variables
    content = readFileSync(DEV_VARS_PATH, 'utf-8');
  } else {
    // File doesn't exist - use .dev.vars.example as template
    isNewFile = true;
    if (existsSync(DEV_VARS_EXAMPLE_PATH)) {
      content = readFileSync(DEV_VARS_EXAMPLE_PATH, 'utf-8');
    } else {
      // Fallback template if .dev.vars.example doesn't exist
      content = 'MISTRAL_API_KEY=""\nOPENAI_API_KEY=""\nR2_PUBLIC_URL=""\n';
    }
  }
  
  // Parse variables and update only R2_PUBLIC_URL
  const lines = content.split('\n');
  const variables = new Map<string, string>();
  const emptyVars: string[] = [];
  
  for (const line of lines) {
    const trimmedLine = line.trim();
    
    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('#')) {
      continue;
    }
    
    // Parse variable
    const match = trimmedLine.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/^["']|["']$/g, ''); // Remove quotes
      
      if (key === 'R2_PUBLIC_URL') {
        // Update R2_PUBLIC_URL with new value
        variables.set(key, r2Url);
      } else {
        // Preserve other variables as-is
        variables.set(key, value);
        
        // Track empty variables (warn user about missing configuration)
        if (!value) {
          emptyVars.push(key);
        }
      }
    }
  }
  
  // Build output content
  const outputLines: string[] = [];
  
  // Ensure all required variables are present (in order from .dev.vars.example)
  const requiredVars = ['MISTRAL_API_KEY', 'OPENAI_API_KEY', 'R2_PUBLIC_URL', 'API_KEY'];
  
  for (const key of requiredVars) {
    if (variables.has(key)) {
      outputLines.push(`${key}="${variables.get(key)}"`);
    } else if (key === 'R2_PUBLIC_URL') {
      outputLines.push(`${key}="${r2Url}"`);
    } else {
      // Variable is missing - add it as empty and track it
      outputLines.push(`${key}=""`);
      if (!emptyVars.includes(key)) {
        emptyVars.push(key);
      }
    }
  }
  
  // Add any additional variables that weren't in the required list
  for (const [key, value] of variables.entries()) {
    if (!requiredVars.includes(key)) {
      outputLines.push(`${key}="${value}"`);
    }
  }
  
  // Write back to file
  writeFileSync(DEV_VARS_PATH, outputLines.join('\n') + '\n');
  
  // Show appropriate messages
  if (isNewFile) {
    console.log('✅ Created .dev.vars file');
  } else {
    console.log('✅ Updated .dev.vars file');
  }
  
  // Warn about empty variables (both new and existing files)
  if (emptyVars.length > 0) {
    // Separate API_KEY from other required vars
    const apiKeyEmpty = emptyVars.includes('API_KEY');
    const otherEmptyVars = emptyVars.filter(key => key !== 'API_KEY');
    
    if (otherEmptyVars.length > 0) {
      console.log(`⚠️  Warning: The following variables are empty and need to be configured:`);
      otherEmptyVars.forEach(key => {
        console.log(`   - ${key}`);
      });
      console.log('   Please edit .dev.vars to add your API keys and configuration.');
    }
    
    if (apiKeyEmpty) {
      console.log('');
      console.log('🔐 API Key Authentication: DISABLED');
      console.log('   To enable API key authentication on all endpoints (except "/"):');
      console.log('   1. Edit .dev.vars and set API_KEY="your-secret-key"');
      console.log('   2. Generate a secure key: openssl rand -base64 32');
      console.log('   3. Restart the dev server');
      console.log('   See SECURITY.md for more information.');
    }
  } else {
    // Check if API_KEY is configured (not empty)
    const apiKeyValue = variables.get('API_KEY');
    if (apiKeyValue) {
      console.log('');
      console.log('🔐 API Key Authentication: ENABLED');
      console.log('   All endpoints (except "/") will require X-API-Key header');
      console.log(`   API Key: ${apiKeyValue.substring(0, 4)}***${apiKeyValue.substring(apiKeyValue.length - 4)}`);
      console.log('   See SECURITY.md for usage details.');
    } else {
      console.log('');
      console.log('🔐 API Key Authentication: DISABLED');
      console.log('   To enable, set API_KEY in .dev.vars (see SECURITY.md)');
    }
  }
  
  if (tunnelUrl) {
    const tunnelName = TUNNEL_TYPE === 'cloudflare' ? 'Cloudflare Tunnel' : 'LocalTunnel';
    console.log(`✅ R2_PUBLIC_URL set to: ${r2Url} (${tunnelName})`);
  } else {
    console.log(`✅ R2_PUBLIC_URL set to: ${r2Url} (localhost only)`);
    console.log('');
    console.log('⚠️  IMPORTANT: Without public tunnel:');
    console.log('   • R2 server will only be accessible locally');
    console.log('   • PDF files will fallback to their original URLs');
    console.log('   • You will NOT see the R2 proxying feature working as it would in production');
    if (TUNNEL_TYPE === 'cloudflare') {
      console.log('   • Cloudflared might not be installed or failed to start');
      console.log('   • Try: npm run goodfellow:dev:localtunnel (as alternative)');
      console.log('   • Try: npm run goodfellow:dev:localhost (localhost-only)');
    } else {
      console.log('   • The localtunnel service might be temporarily unavailable');
      console.log('   • Try: npm run goodfellow:dev (uses Cloudflare Tunnel instead)');
      console.log('   • Try: npm run goodfellow:dev:localhost (localhost-only)');
    }
  }
}

/**
 * Start Goodfellow dev server (cross-platform)
 */
function startGoodfellowServer(): void {
  console.log('🚀 Starting Goodfellow dev server...');
  
  // On Windows, we might need to use wrangler.cmd
  const wranglerCmd = IS_WINDOWS ? 'wrangler.cmd' : 'wrangler';
  
  const goodfellowProcess = spawn(
    wranglerCmd,
    ['dev', '--config', 'wrangler.jsonc', '--env', 'development'],
    {
      stdio: 'inherit',
      detached: false,
      shell: true // Use shell for better cross-platform compatibility
    }
  );
  
  processes.goodfellow = goodfellowProcess;
  
  goodfellowProcess.on('error', (error) => {
    console.error('❌ Failed to start Goodfellow server:', error);
    cleanup(true);
  });
  
  goodfellowProcess.on('exit', (code) => {
    console.log(`Goodfellow server exited with code ${code}`);
    cleanup(true);
  });
}

/**
 * Main execution
 */
async function main() {
  console.log('🎬 Starting development environment setup...');
  
  let tunnelDescription: string;
  if (FORCE_LOCALHOST) {
    tunnelDescription = 'Localhost only (--localhost flag)';
  } else {
    tunnelDescription = TUNNEL_TYPE === 'cloudflare' ? 'Cloudflare Tunnel' : 'LocalTunnel';
  }
  
  console.log(`🌐 Tunnel type: ${tunnelDescription}\n`);
  
  try {
    // Step 1: Check and setup D1 tables
    if (!checkD1Tables()) {
      setupD1Tables();
    }
    
    console.log('');
    
    // Step 2: Start R2 dev server and get the port it's running on
    const detectedPort = await startR2Server();
    
    console.log('');
    
    // Step 2.5: Wait for R2 server to be fully ready and accepting connections
    console.log('⏳ Waiting for R2 server to be fully operational...');
    await new Promise(resolve => setTimeout(resolve, 3000)); // Give it 3 seconds to fully initialize
    await healthCheckR2Server(detectedPort);
    
    console.log('');
    
    // Step 3: Verify R2 server is accessible locally before tunneling
    console.log('🔍 Verifying R2 server is accessible locally...');
    try {
      const localTest = await fetch(`http://localhost:${detectedPort}/`, {
        signal: AbortSignal.timeout(3000)
      }).catch(() => null);
      
      if (localTest) {
        console.log('✅ R2 server is accessible on localhost');
      } else {
        console.log('⚠️  R2 server might not be fully ready yet');
      }
    } catch (error) {
      console.log('⚠️  Could not verify R2 server accessibility');
    }
    
    console.log('');
    
    // Step 4: Create tunnel (now that R2 is definitely ready)
    const tunnelUrl = await createTunnel(detectedPort);
    
    // Show tunnel result
    if (tunnelUrl) {
      console.log(`✅ Tunnel created successfully: ${tunnelUrl}`);
    } else if (!FORCE_LOCALHOST) {
      console.log('ℹ️  No tunnel created - using localhost for R2_PUBLIC_URL');
    }
    
    console.log('');
    
    // Step 5: Update .dev.vars
    updateDevVars(tunnelUrl, detectedPort);
    
    console.log('');
    
    // Give services a moment to stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 6: Start Goodfellow dev server
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Setup complete! Starting Goodfellow...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    startGoodfellowServer();
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    cleanup(false); // Don't exit here since we're calling process.exit(1) below
    process.exit(1);
  }
}

// Run the main function
main();

