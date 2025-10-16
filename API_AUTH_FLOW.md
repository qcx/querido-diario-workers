# API Authentication Flow

## Visual Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        API REQUEST AUTHENTICATION FLOW                      │
└─────────────────────────────────────────────────────────────────────────────┘

                                   📥 Incoming Request
                                          ↓
                        ┌─────────────────────────────────┐
                        │   Is path "/" (root)?           │
                        └─────────────────────────────────┘
                                      ↓
                            ┌─────────┴─────────┐
                           YES                  NO
                            ↓                    ↓
                    ┌──────────────┐    ┌──────────────────┐
                    │ Allow Access │    │ Check API_KEY    │
                    │ (Public)     │    │ Environment Var  │
                    └──────────────┘    └──────────────────┘
                            ↓                    ↓
                            │           ┌────────┴────────┐
                            │          SET              UNSET
                            │           ↓                  ↓
                            │   ┌──────────────┐  ┌──────────────┐
                            │   │ Auth Enabled │  │ Allow Access │
                            │   └──────────────┘  │ (Public)     │
                            │           ↓         └──────────────┘
                            │   ┌──────────────────────┐      ↓
                            │   │ Check X-API-Key      │      │
                            │   │ Header               │      │
                            │   └──────────────────────┘      │
                            │           ↓                     │
                            │   ┌───────┴───────┐             │
                            │  PRESENT        MISSING         │
                            │   ↓                ↓            │
                            │   │        ┌──────────────┐     │
                            │   │        │ Return 401   │     │
                            │   │        │ "Missing"    │     │
                            │   │        └──────────────┘     │
                            │   ↓                             │
                            │ ┌──────────────────────┐        │
                            │ │ Compare with         │        │
                            │ │ API_KEY value        │        │
                            │ └──────────────────────┘        │
                            │           ↓                     │
                            │   ┌───────┴───────┐             │
                            │  MATCH        MISMATCH          │
                            │   ↓                ↓            │
                            │   │        ┌──────────────┐     │
                            │   │        │ Return 403   │     │
                            │   │        │ "Invalid"    │     │
                            │   │        └──────────────┘     │
                            │   ↓                             │
                            │ ┌──────────────────────┐        │
                            │ │ Log Success          │        │
                            │ │ Allow Access         │        │
                            │ └──────────────────────┘        │
                            │           ↓                     │
                            └───────────┴─────────────────────┘
                                        ↓
                              ┌──────────────────┐
                              │ Process Request  │
                              │ (Route Handler)  │
                              └──────────────────┘
                                        ↓
                                   📤 Response
```

## Decision Matrix

| Scenario | Path | API_KEY Set? | X-API-Key Header | Result |
|----------|------|-------------|------------------|--------|
| 1 | `/` | No | - | ✅ 200 OK (Public) |
| 2 | `/` | Yes | - | ✅ 200 OK (Public) |
| 3 | `/` | Yes | Valid | ✅ 200 OK (Public) |
| 4 | `/` | Yes | Invalid | ✅ 200 OK (Public) |
| 5 | `/spiders` | No | - | ✅ 200 OK (No auth) |
| 6 | `/spiders` | Yes | Missing | ❌ 401 Unauthorized |
| 7 | `/spiders` | Yes | Invalid | ❌ 403 Forbidden |
| 8 | `/spiders` | Yes | Valid | ✅ 200 OK (Authenticated) |

## Code Flow

```typescript
// 1. Middleware runs on every request
app.use('*', async (c, next) => {
  
  // 2. Check if it's the root path (always public)
  if (c.req.path === '/') {
    return next(); // Skip authentication
  }

  // 3. Check if API_KEY is configured
  const configuredApiKey = c.env.API_KEY;
  
  // 4. If not configured, allow all requests
  if (!configuredApiKey) {
    return next(); // No authentication required
  }

  // 5. API_KEY is configured, check the header
  const providedApiKey = c.req.header('X-API-Key');

  // 6. Header missing?
  if (!providedApiKey) {
    return c.json({ error: 'Authentication required' }, 401);
  }

  // 7. Header doesn't match?
  if (providedApiKey !== configuredApiKey) {
    return c.json({ error: 'Authentication failed' }, 403);
  }

  // 8. Success! Log and continue
  logger.info('Authenticated API request');
  await next();
});
```

## Response Codes

### ✅ 200 OK
**When:** Authentication successful or not required

**Response:** Endpoint-specific data
```json
{
  "total": 3107,
  "spiders": [...]
}
```

### ❌ 401 Unauthorized
**When:** API_KEY is set but X-API-Key header is missing

**Response:**
```json
{
  "error": "Authentication required",
  "message": "Missing X-API-Key header"
}
```

**Logs:**
```json
{
  "level": "warn",
  "message": "API request without X-API-Key header",
  "path": "/spiders",
  "method": "GET",
  "ip": "203.0.113.42"
}
```

### ❌ 403 Forbidden
**When:** X-API-Key header is present but doesn't match API_KEY

**Response:**
```json
{
  "error": "Authentication failed",
  "message": "Invalid X-API-Key"
}
```

**Logs:**
```json
{
  "level": "warn",
  "message": "API request with invalid X-API-Key",
  "path": "/spiders",
  "method": "GET",
  "ip": "203.0.113.42"
}
```

## Example Requests

### Without Authentication (API_KEY not set)

```bash
# All requests work without headers
curl http://localhost:8787/spiders
# ✅ 200 OK

curl -X POST http://localhost:8787/crawl/cities \
  -H "Content-Type: application/json" \
  -d '{"cities": ["am_1300144"]}'
# ✅ 200 OK (or appropriate status)
```

### With Authentication (API_KEY set)

```bash
# Root endpoint always works
curl http://localhost:8787/
# ✅ 200 OK (shows authEnabled: true)

# Other endpoints require X-API-Key
curl http://localhost:8787/spiders
# ❌ 401 Unauthorized

curl http://localhost:8787/spiders \
  -H "X-API-Key: wrong-key"
# ❌ 403 Forbidden

curl http://localhost:8787/spiders \
  -H "X-API-Key: correct-key"
# ✅ 200 OK
```

## Security Headers Captured

The middleware captures these headers for logging:

- `X-API-Key`: The authentication header
- `cf-connecting-ip`: Cloudflare's client IP address
- `user-agent`: Client identification (captured by endpoint handlers)

## Integration Points

### 1. Cloudflare Dashboard
```
Settings → Environment Variables → API_KEY
```

### 2. Wrangler CLI
```bash
wrangler secret put API_KEY
```

### 3. .dev.vars (Local)
```bash
API_KEY="your-dev-key"
```

### 4. Client Code
```javascript
// JavaScript/TypeScript
fetch('https://api.example.com/spiders', {
  headers: {
    'X-API-Key': 'your-api-key'
  }
})

// cURL
curl -H "X-API-Key: your-api-key" https://api.example.com/spiders

// Python
import requests
headers = {'X-API-Key': 'your-api-key'}
response = requests.get('https://api.example.com/spiders', headers=headers)
```

## Monitoring & Alerting

### Key Metrics to Track

1. **Authentication Success Rate**
   - Monitor ratio of 200 vs 401/403 responses
   - Alert if success rate drops below threshold

2. **Failed Attempts by IP**
   - Track 401/403 responses per IP
   - Alert on suspicious patterns (many attempts from same IP)

3. **Geographic Anomalies**
   - Monitor requests from unexpected countries
   - Alert on first-time country access

4. **Usage Patterns**
   - Track requests per hour/day
   - Alert on unusual spikes

### Log Queries (Cloudflare Analytics)

```sql
-- Failed authentication attempts
SELECT 
  cf.connecting_ip,
  COUNT(*) as attempts,
  MAX(timestamp) as last_attempt
FROM logs
WHERE response_status IN (401, 403)
GROUP BY cf.connecting_ip
ORDER BY attempts DESC
LIMIT 10
```

## Troubleshooting

### Issue: All requests return 401

**Diagnosis:**
```bash
# Check if auth is enabled
curl https://your-worker.workers.dev/
# Look for: "authEnabled": true
```

**Solution:**
- Verify you're sending the `X-API-Key` header
- Check the header value matches the secret

### Issue: Auth works locally but not in production

**Diagnosis:**
```bash
# Check if secret is set
wrangler secret list
```

**Solution:**
```bash
wrangler secret put API_KEY --env production
```

### Issue: Want to disable auth temporarily

**Solution:**
```bash
# Delete the secret
wrangler secret delete API_KEY --env production

# Or leave unset on new deployment
```

