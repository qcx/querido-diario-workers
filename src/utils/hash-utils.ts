/**
 * Cryptographic hashing utilities for Cloudflare Workers
 * Uses Web Crypto API (crypto.subtle) which is available in Workers runtime
 */

/**
 * Generate SHA-256 hash of input string
 * @param input - String to hash
 * @returns Hex-encoded SHA-256 hash (64 characters)
 */
export async function sha256Hash(input: string): Promise<string> {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    
    // Use Web Crypto API (available in Cloudflare Workers)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    
    // Convert to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    return hashHex;
  } catch (error) {
    throw new Error(`Failed to generate SHA-256 hash: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Generate a short hash (truncated SHA-256) for use in IDs
 * @param input - String to hash
 * @param length - Length of truncated hash (default: 16 characters)
 * @returns Truncated hex-encoded SHA-256 hash
 */
export async function shortHash(input: string, length: number = 16): Promise<string> {
  const fullHash = await sha256Hash(input);
  return fullHash.substring(0, length);
}

