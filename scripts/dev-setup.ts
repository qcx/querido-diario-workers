#!/usr/bin/env node
/**
 * Development Setup Script
 * 
 * This script orchestrates the complete development environment setup:
 * 1. Checks and sets up D1 tables if needed
 * 2. Starts R2 dev server and detects the port Wrangler assigns
 * 3. Health checks R2 server to ensure it's fully ready
 * 4. Creates localtunnel for R2 server (optional, falls back to localhost if unavailable)
 * 5. Updates .dev.vars with tunnel URL (or localhost with detected port)
 * 6. Starts the main Goodfellow dev server
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
 * • Localtunnel: Creates a public tunnel using localtunnel.me
 *   - If tunnel creation fails, falls back to localhost URL
 *   - No additional installation required (included as npm dependency)
 * • File paths: Uses Node.js path utilities for proper path handling
 * 
 * The script will work even if the tunnel fails to create, falling back
 * to localhost URLs for local development.
 */

import { spawn, execSync, ChildProcess } from 'child_process';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import localtunnel from 'localtunnel';

const ROOT_DIR = process.cwd();
const DEV_VARS_PATH = join(ROOT_DIR, '.dev.vars');
const IS_WINDOWS = process.platform === 'win32';

interface ProcessManager {
  r2Server?: ChildProcess;
  tunnel?: any; // localtunnel instance
  goodfellow?: ChildProcess;
}

const processes: ProcessManager = {};
let R2_PORT: number | null = null; // Will be set dynamically from Wrangler output

// Cleanup function to kill all spawned processes
function cleanup() {
  console.log('\n🧹 Cleaning up processes...');
  
  if (processes.goodfellow) {
    processes.goodfellow.kill();
  }
  if (processes.tunnel) {
    processes.tunnel.close();
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
 * Create localtunnel (returns localhost URL if tunnel creation fails)
 */
async function createTunnel(port: number): Promise<string | null> {
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
  const requiredVars = ['MISTRAL_API_KEY', 'OPENAI_API_KEY', 'R2_PUBLIC_URL'];
  
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
    console.log(`⚠️  Warning: The following variables are empty and need to be configured:`);
    emptyVars.forEach(key => {
      console.log(`   - ${key}`);
    });
    console.log('   Please edit .dev.vars to add your API keys and configuration.');
  }
  
  if (tunnelUrl) {
    console.log(`✅ R2_PUBLIC_URL set to: ${r2Url} (public tunnel)`);
  } else {
    console.log(`✅ R2_PUBLIC_URL set to: ${r2Url} (localhost only)`);
    console.log('');
    console.log('⚠️  IMPORTANT: Without public tunnel:');
    console.log('   • R2 server will only be accessible locally');
    console.log('   • PDF files will fallback to their original URLs');
    console.log('   • You will NOT see the R2 proxying feature working as it would in production');
    console.log('   • The localtunnel service might be temporarily unavailable');
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
      const localTest = await fetch(`http://localhost:${detectedPort}/health`, {
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
    
    // Step 4: Create localtunnel (now that R2 is definitely ready)
    const tunnelUrl = await createTunnel(detectedPort);
    
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
    cleanup();
    process.exit(1);
  }
}

// Run the main function
main();

