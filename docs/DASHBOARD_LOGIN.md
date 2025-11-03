# Dashboard Login System

## Overview

The dashboard now includes a login system with session-based authentication. Users must authenticate before accessing any dashboard pages.

## Authentication Flow

1. **User visits `/dashboard`** → Redirected to `/dashboard/login`
2. **Login page displays** with username and password fields
3. **User enters credentials**:
   - Username: `admin`
   - Password: Your API Key (from environment variable)
4. **Server validates credentials**:
   - Checks if username === "admin"
   - Checks if password === API_KEY environment variable
5. **On success**:
   - Sets secure session cookie (7-day expiry)
   - Redirects to `/dashboard`
6. **On failure**:
   - Shows error message "Invalid username or password"
   - User can try again

## Credentials

- **Username**: `admin` (hardcoded)
- **Password**: Value of `API_KEY` environment variable

## Session Management

### Cookie Details
- **Name**: `dashboard_session`
- **Duration**: 7 days
- **Security**: 
  - `httpOnly`: true (prevents JavaScript access)
  - `secure`: true (HTTPS only)
  - `sameSite`: 'Strict' (CSRF protection)
  - `path`: '/dashboard' (scoped to dashboard only)

### Session Token
- Base64-encoded combination of API key and timestamp
- Validated on every dashboard page request
- Automatically expires after 7 days

## Routes

### Public Routes (No Auth Required)
- `GET /dashboard/login` - Login page
- `POST /dashboard/login` - Login form submission

### Protected Routes (Auth Required)
- All other `/dashboard/*` routes
- Automatically redirects to login if not authenticated

### Logout
- `GET /dashboard/logout` - Clears session and redirects to login

## Security Features

1. **Session-Based Auth**: Uses secure cookies instead of storing credentials
2. **HTTP-Only Cookies**: Prevents XSS attacks
3. **Secure Flag**: Cookie only sent over HTTPS
4. **SameSite Protection**: Prevents CSRF attacks
5. **Scoped Cookies**: Only sent to `/dashboard/*` paths
6. **Auto-Expiry**: Sessions expire after 7 days

## Usage

### First Time Access

```
1. Visit: https://your-worker.workers.dev/dashboard
2. Redirected to: https://your-worker.workers.dev/dashboard/login
3. Enter:
   - Username: admin
   - Password: [your-api-key]
4. Click "Sign in"
5. Access granted to all dashboard pages
```

### Logging Out

Click "Logout" in the header or visit `/dashboard/logout` directly.

### Session Expiry

Sessions expire after 7 days. Users will be redirected to the login page and need to re-authenticate.

## Setting the API Key

The dashboard uses the same `API_KEY` environment variable as the rest of the API.

### For Development

```bash
# In .dev.vars file
API_KEY=your-secret-key-here
```

### For Production

```bash
# Using Wrangler CLI
wrangler secret put API_KEY
# Then enter your secret key when prompted
```

### Cloudflare Dashboard

1. Go to your Worker settings
2. Navigate to "Settings" → "Variables"
3. Add encrypted variable: `API_KEY`
4. Save

## Implementation Details

### Files

- `src/dashboards/auth.ts` - Authentication utilities
  - `isAuthenticated()` - Check if user has valid session
  - `authenticate()` - Validate credentials and create session
  - `logout()` - Clear session cookie
  - `redirectToLogin()` - Helper to redirect to login page

- `src/dashboards/pages/login.tsx` - Login page component
  - Simple form with username and password fields
  - Error message display
  - Pre-filled username field

- `src/routes/dashboard-routes.ts` - Updated with auth middleware
  - Public routes for login/logout
  - Auth middleware for all protected routes
  - Automatic redirect to login if not authenticated

- `src/dashboards/layout.tsx` - Added logout link in header

### Middleware Flow

```
Request → Dashboard Route
    ↓
Is login/logout route?
    Yes → Skip auth check
    No → Check session cookie
        ↓
    Valid session?
        Yes → Continue to page
        No → Redirect to login
```

## Customization

### Change Username

Edit `src/dashboards/auth.ts`:

```typescript
if (username !== 'your-custom-username' || password !== apiKey) {
  return false;
}
```

### Change Session Duration

Edit `src/dashboards/auth.ts`:

```typescript
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
```

### Use Database for Users

Replace the hardcoded check with a database lookup:

```typescript
export async function authenticate(c: Context, username: string, password: string): Promise<boolean> {
  const db = getDatabase(c.env);
  const user = await db.getDb()
    .select()
    .from(users)
    .where(eq(users.username, username))
    .limit(1);
    
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return false;
  }
  
  // Set session...
  return true;
}
```

## Testing

### Test Login

```bash
# Start dev server
npm run dev

# Open browser
open http://localhost:8787/dashboard

# Should redirect to login page
# Enter credentials:
# - Username: admin
# - Password: [value of API_KEY from .dev.vars]
```

### Test Logout

1. After logging in, click "Logout" in header
2. Should redirect to login page
3. Trying to access `/dashboard` should redirect to login

### Test Session Persistence

1. Log in successfully
2. Close browser tab
3. Open new tab to `/dashboard`
4. Should still be logged in (cookie persists)

## Troubleshooting

### Cannot Log In - "Invalid username or password"

**Check:**
1. API_KEY is set in environment (`.dev.vars` for local, Wrangler secrets for production)
2. Username is exactly "admin" (case-sensitive)
3. Password matches the API_KEY value exactly

### Immediately Redirected After Login

**Possible causes:**
1. Cookies disabled in browser
2. HTTP instead of HTTPS (secure flag prevents cookie on HTTP in production)
3. Cookie not being set due to domain mismatch

**Solutions:**
- Enable cookies in browser
- For local development, the secure flag is handled by the environment
- Check browser DevTools → Application → Cookies

### Session Expires Too Quickly

**Check:**
- Browser is not in incognito/private mode (cookies may not persist)
- Session duration in `auth.ts` (default: 7 days)

## Production Considerations

1. **Use Strong API Key**: Ensure your API_KEY is a strong, random string
2. **HTTPS Only**: Always use HTTPS in production (Cloudflare Workers handles this)
3. **Monitor Failed Logins**: Consider adding logging for failed authentication attempts
4. **Rate Limiting**: Consider adding rate limiting to prevent brute force attacks
5. **Multi-User**: For multiple users, implement a proper user database

## Future Enhancements

Potential improvements:

1. **Multiple Users**: Store users in D1 database
2. **Password Hashing**: Use bcrypt or similar for password storage
3. **Role-Based Access**: Different permissions for different users
4. **Two-Factor Auth**: Add 2FA for extra security
5. **Session Management**: View/revoke active sessions
6. **Login History**: Track login attempts and sessions
7. **Remember Me**: Optional extended session duration
8. **Password Reset**: Email-based password reset flow

