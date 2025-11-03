/**
 * Dashboard authentication utilities
 */

import { Context } from 'hono';
import { setCookie, getCookie, deleteCookie } from 'hono/cookie';

const SESSION_COOKIE_NAME = 'dashboard_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

/**
 * Generate a session token
 * Simple approach: hash the API key with timestamp
 */
function generateSessionToken(apiKey: string): string {
  const timestamp = Date.now().toString();
  const data = `${apiKey}:${timestamp}`;
  
  // Simple base64 encoding (in production, use proper signing)
  return btoa(data);
}

/**
 * Verify session token
 */
function verifySessionToken(token: string, apiKey: string): boolean {
  try {
    const decoded = atob(token);
    const [tokenApiKey] = decoded.split(':');
    return tokenApiKey === apiKey;
  } catch {
    return false;
  }
}

/**
 * Check if user is authenticated
 */
export function isAuthenticated(c: Context): boolean {
  const sessionToken = getCookie(c, SESSION_COOKIE_NAME);
  const apiKey = c.env.API_KEY;
  
  if (!sessionToken || !apiKey) {
    return false;
  }
  
  return verifySessionToken(sessionToken, apiKey);
}

/**
 * Authenticate user with credentials
 */
export function authenticate(c: Context, username: string, password: string): boolean {
  const apiKey = c.env.API_KEY;
  
  // Check credentials
  if (username !== 'admin' || password !== apiKey) {
    return false;
  }
  
  // Set session cookie
  const sessionToken = generateSessionToken(apiKey);
  setCookie(c, SESSION_COOKIE_NAME, sessionToken, {
    maxAge: SESSION_MAX_AGE,
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    path: '/dashboard',
  });
  
  return true;
}

/**
 * Logout user
 */
export function logout(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, {
    path: '/dashboard',
  });
}

/**
 * Redirect to login page
 */
export function redirectToLogin(c: Context) {
  return c.redirect('/dashboard/login');
}

