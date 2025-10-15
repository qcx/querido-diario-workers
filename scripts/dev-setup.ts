#!/usr/bin/env node
/**
 * Development Setup Script
 * 
 * This script orchestrates the complete development environment setup:
 * 1. Checks and sets up D1 tables if needed
 * 2. Starts R2 dev server
 * 3. Creates Cloudflare tunnel for R2 server (optional, skips if cloudflared not available)
 * 4. Updates .dev.vars with tunnel URL (or localhost if no tunnel)
 * 5. Starts the main Goodfellow dev server
 * 
 * ═══════════════════════════════════════════════════════════════════
 * CROSS-PLATFORM COMPATIBILITY
 * ═══════════════════════════════════════════════════════════════════
 * 
 * This script works on Windows, macOS, and Linux:
 * 
 * • Wrangler commands: Uses 'wrangler.cmd' on Windows, 'wrangler' on Unix
 * • Process spawning: Uses shell mode for better cross-platform command execution
 * • Cloudflared tunnel: OPTIONAL - gracefully skips if not installed
 *   - If cloudflared is not available, uses localhost URL instead
 *   - Provides platform-specific installation instructions
 * • File paths: Uses Node.js path utilities for proper path handling
 * 
 * The script will work even if cloudflared is not installed, falling back
 * to localhost URLs for local development.
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';

const ROOT_DIR = process.cwd();
const DEV_VARS_PATH = join(ROOT_DIR, '.dev.vars');
const R2_PORT = 34381;
const IS_WINDOWS = process.platform === 'win32';

interface ProcessManager {
  r2Server?: ChildProcess;
  tunnel?: ChildProcess;
  goodfellow?: ChildProcess;
}

const processes: ProcessManager = {};

// Cleanup function to kill all spawned processes
function cleanup() {
  console.log('\n🧹 Cleaning up processes...');
  
  if (processes.goodfellow) {
    processes.goodfellow.kill();
  }
  if (processes.tunnel) {
    processes.tunnel.kill();
  }
  if (processes.r2Server) {
    processes.r2Server.kill();
  }
  
  process.exit(0);
}

// Register cleanup handlers
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('exit', cleanup);

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
      `${wranglerCmd} d1 execute querido-diario-prod --local --command="SELECT name FROM sqlite_master WHERE type='table'"`,
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
      `${wranglerCmd} d1 execute querido-diario-prod --local --file=database/schema-d1.sql`,
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
 * Start R2 dev server (cross-platform)
 */
async function startR2Server(): Promise<void> {
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
    
    r2Process.stdout?.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      // Check if server is ready
      if (text.includes('Ready on') || text.includes(`http://localhost:${R2_PORT}`)) {
        console.log('✅ R2 dev server is ready');
        resolve();
      }
    });
    
    r2Process.stderr?.on('data', (data) => {
      console.error(`R2 Server: ${data}`);
    });
    
    r2Process.on('error', (error) => {
      console.error('❌ Failed to start R2 server:', error);
      reject(error);
    });
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (!output.includes('Ready on')) {
        console.log('⚠️  R2 server startup timeout - continuing anyway...');
        resolve();
      }
    }, 30000);
  });
}

/**
 * Check if cloudflared is installed (cross-platform)
 */
function isCloudflaredInstalled(): boolean {
  try {
    // Try to run cloudflared --version to check if it's available
    execSync('cloudflared --version', { 
      stdio: 'ignore'
    } as any);
    return true;
  } catch {
    return false;
  }
}

/**
 * Print cloudflared installation instructions
 */
function printCloudflaredInstructions(): void {
  console.log('\n⚠️  cloudflared is not installed');
  console.log('📝 To enable public tunnel for R2 server, install cloudflared:');
  console.log('');
  
  if (IS_WINDOWS) {
    console.log('Windows:');
    console.log('  Download from: https://github.com/cloudflare/cloudflared/releases/latest');
    console.log('  Or use: winget install cloudflare.cloudflared');
  } else if (process.platform === 'darwin') {
    console.log('macOS:');
    console.log('  brew install cloudflared');
  } else {
    console.log('Linux:');
    console.log('  wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64');
    console.log('  chmod +x cloudflared-linux-amd64');
    console.log('  sudo mv cloudflared-linux-amd64 /usr/local/bin/cloudflared');
  }
  
  console.log('');
  console.log('More info: https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/installation/');
  console.log('\n⏭️  Continuing without tunnel (using localhost)...\n');
}

/**
 * Create Cloudflare tunnel (optional, returns localhost URL if cloudflared not available)
 */
async function createTunnel(): Promise<string | null> {
  return new Promise((resolve) => {
    console.log('🌐 Checking for Cloudflare tunnel capability...');
    
    if (!isCloudflaredInstalled()) {
      printCloudflaredInstructions();
      // Return null to indicate no tunnel available
      resolve(null);
      return;
    }
    
    console.log('🚀 Creating Cloudflare tunnel...');
    
    const tunnelProcess = spawn(
      'cloudflared',
      ['tunnel', '--url', `http://localhost:${R2_PORT}`],
      {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
        shell: IS_WINDOWS // Use shell on Windows for better compatibility
      }
    );
    
    processes.tunnel = tunnelProcess;
    
    let tunnelUrl = '';
    
    tunnelProcess.stdout?.on('data', (data) => {
      const text = data.toString();
      console.log(`Tunnel: ${text.trim()}`);
      
      // Extract tunnel URL
      const urlMatch = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (urlMatch && !tunnelUrl) {
        tunnelUrl = urlMatch[0];
        console.log(`✅ Tunnel created: ${tunnelUrl}`);
        resolve(tunnelUrl);
      }
    });
    
    tunnelProcess.stderr?.on('data', (data) => {
      const text = data.toString();
      // Cloudflared often outputs to stderr even for normal logs
      console.log(`Tunnel: ${text.trim()}`);
      
      const urlMatch = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (urlMatch && !tunnelUrl) {
        tunnelUrl = urlMatch[0];
        console.log(`✅ Tunnel created: ${tunnelUrl}`);
        resolve(tunnelUrl);
      }
    });
    
    tunnelProcess.on('error', (error) => {
      console.error('⚠️  Failed to create tunnel:', error);
      console.log('⏭️  Continuing without tunnel (using localhost)...');
      resolve(null);
    });
    
    // Timeout after 30 seconds
    setTimeout(() => {
      if (!tunnelUrl) {
        console.log('⚠️  Tunnel creation timeout');
        console.log('⏭️  Continuing without tunnel (using localhost)...');
        resolve(null);
      }
    }, 30000);
  });
}

/**
 * Update .dev.vars file with tunnel URL or localhost
 */
function updateDevVars(tunnelUrl: string | null): void {
  console.log('📝 Updating .dev.vars...');
  
  // Use tunnel URL if available, otherwise use localhost
  const r2Url = tunnelUrl || `http://localhost:${R2_PORT}`;
  
  let content = '';
  
  // Read existing .dev.vars if it exists
  if (existsSync(DEV_VARS_PATH)) {
    content = readFileSync(DEV_VARS_PATH, 'utf-8');
  }
  
  // Update or add R2_PUBLIC_URL
  const lines = content.split('\n');
  let updated = false;
  
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('R2_PUBLIC_URL=')) {
      lines[i] = `R2_PUBLIC_URL=${r2Url}`;
      updated = true;
      break;
    }
  }
  
  if (!updated) {
    lines.push(`R2_PUBLIC_URL=${r2Url}`);
  }
  
  // Write back to file
  writeFileSync(DEV_VARS_PATH, lines.join('\n').trim() + '\n');
  
  if (tunnelUrl) {
    console.log(`✅ R2_PUBLIC_URL set to: ${r2Url} (public tunnel)`);
  } else {
    console.log(`✅ R2_PUBLIC_URL set to: ${r2Url} (localhost only)`);
    console.log('⚠️  Note: R2 server will only be accessible locally');
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
    cleanup();
  });
  
  goodfellowProcess.on('exit', (code) => {
    console.log(`Goodfellow server exited with code ${code}`);
    cleanup();
  });
}

/**
 * Main execution
 */
async function main() {
  console.log('🎬 Starting development environment setup...\n');
  
  try {
    // Step 1: Check and setup D1 tables
    if (!checkD1Tables()) {
      setupD1Tables();
    }
    
    console.log('');
    
    // Step 2: Start R2 dev server
    await startR2Server();
    
    console.log('');
    
    // Step 3: Create Cloudflare tunnel
    const tunnelUrl = await createTunnel();
    
    console.log('');
    
    // Step 4: Update .dev.vars
    updateDevVars(tunnelUrl);
    
    console.log('');
    
    // Give services a moment to stabilize
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 5: Start Goodfellow dev server
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✨ Setup complete! Starting Goodfellow...');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    startGoodfellowServer();
    
  } catch (error) {
    console.error('\n❌ Setup failed:', error);
    cleanup();
    process.exit(1);
  }
}

// Run the main function
main();

