/**
 * Dashboard routes for Hono server
 */

import { Hono } from 'hono';
import type { GoodfellowEnv } from '../goodfellow-worker';
import { renderDashboardPage, renderLoginPage } from '../dashboards/server-renderer';
import { isAuthenticated, authenticate, logout, redirectToLogin } from '../dashboards/auth';

const dashboardRoutes = new Hono<{ Bindings: GoodfellowEnv }>();

/**
 * Login page (public)
 */
dashboardRoutes.get('/login', (c) => {
  // If already authenticated, redirect to dashboard
  if (isAuthenticated(c)) {
    return c.redirect('/dashboard');
  }
  
  const html = renderLoginPage();
  return c.html(html);
});

/**
 * Login form handler (public)
 */
dashboardRoutes.post('/login', async (c) => {
  const formData = await c.req.formData();
  const username = formData.get('username') as string;
  const password = formData.get('password') as string;
  
  if (authenticate(c, username, password)) {
    return c.redirect('/dashboard');
  }
  
  // Authentication failed
  const html = renderLoginPage('Invalid username or password');
  return c.html(html, 401);
});

/**
 * Logout handler
 */
dashboardRoutes.get('/logout', (c) => {
  logout(c);
  return c.redirect('/dashboard/login');
});

/**
 * Authentication middleware for all dashboard routes
 */
dashboardRoutes.use('/*', async (c, next) => {
  // Skip auth check for login and logout routes
  if (c.req.path === '/dashboard/login' || c.req.path === '/dashboard/logout') {
    return next();
  }
  
  // Check authentication
  if (!isAuthenticated(c)) {
    return redirectToLogin(c);
  }
  
  await next();
});

/**
 * Dashboard route handler - renders React components with SSR
 */
dashboardRoutes.get('/*', async (c) => {
  try {
    // Get pathname
    const url = new URL(c.req.url);
    const pathname = url.pathname;
    
    // Create context with environment bindings
    const context = {
      env: c.env,
    };
    
    // Render the dashboard page
    const html = await renderDashboardPage(pathname, context);
    
    // Return HTML response
    return c.html(html);
  } catch (error) {
    console.error('Dashboard route error:', error);
    
    // Return error response
    return c.html(
      `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Dashboard Error</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="bg-gray-100">
          <div class="min-h-screen flex items-center justify-center">
            <div class="bg-white p-8 rounded-lg shadow-md max-w-md">
              <h1 class="text-2xl font-bold text-red-600 mb-4">Dashboard Error</h1>
              <p class="text-gray-700 mb-4">${error instanceof Error ? error.message : 'An error occurred'}</p>
              <a href="/dashboard" class="text-blue-600 hover:underline">Return to Dashboard</a>
            </div>
          </div>
        </body>
      </html>
      `,
      500
    );
  }
});

export default dashboardRoutes;

