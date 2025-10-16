# Security Documentation

## API Key Authentication

Goodfellow supports optional API key authentication to protect endpoints from unauthorized access.

### How It Works

1. **Optional Protection**: Authentication is only enabled when the `API_KEY` environment variable is set
2. **Header-Based**: Clients must provide the API key via the `X-API-Key` HTTP header
3. **Public Health Check**: The root endpoint (`/`) is always public for health checks
4. **Protected Endpoints**: All other endpoints require authentication when enabled

### Setup

#### Local Development

Add the `API_KEY` to your `.dev.vars` file:

```bash
API_KEY="your-secret-key-here"
```

#### Production/Staging

Set the secret via Wrangler:

```bash
# For production
wrangler secret put API_KEY --config wrangler.jsonc --env production

# For staging
wrangler secret put API_KEY --config wrangler.jsonc --env staging
```

You'll be prompted to enter the API key value.

### Usage

#### Without Authentication (API_KEY not set)

All endpoints are accessible without any authentication:

```bash
curl https://goodfellow-prod.qconcursos.workers.dev/crawl/cities \
  -H "Content-Type: application/json" \
  -d '{"cities": ["am_1300144"]}'
```

#### With Authentication (API_KEY is set)

Include the `X-API-Key` header in all requests (except root `/`):

```bash
curl https://goodfellow-prod.qconcursos.workers.dev/crawl/cities \
  -H "X-API-Key: your-secret-key-here" \
  -H "Content-Type: application/json" \
  -d '{"cities": ["am_1300144"]}'
```

### Protected Endpoints

When authentication is enabled, the following endpoints require the `X-API-Key` header:

- `POST /crawl` - Dispatch crawl jobs
- `POST /crawl/today-yesterday` - Crawl today and yesterday
- `POST /crawl/cities` - Crawl specific cities
- `GET /spiders` - List available spiders
- `GET /stats` - Get statistics
- `GET /health/queue` - Queue health check

### Public Endpoints

The following endpoints are always accessible without authentication:

- `GET /` - Root health check

### Error Responses

#### Missing API Key (401)

```json
{
  "error": "Authentication required",
  "message": "Missing X-API-Key header"
}
```

#### Invalid API Key (403)

```json
{
  "error": "Authentication failed",
  "message": "Invalid X-API-Key"
}
```

### Testing

Use the provided test script to verify authentication:

```bash
# Test without API key (when API_KEY is not set)
bun run scripts/test-api-auth.ts http://localhost:8787

# Test with API key (when API_KEY is set)
bun run scripts/test-api-auth.ts http://localhost:8787 your-secret-key-here

# Test production
bun run scripts/test-api-auth.ts https://goodfellow-prod.qconcursos.workers.dev your-secret-key-here
```

### Security Best Practices

1. **Strong Keys**: Use cryptographically secure random strings for API keys
   ```bash
   # Generate a secure API key
   openssl rand -base64 32
   ```

2. **Key Rotation**: Regularly rotate API keys, especially after:
   - Security incidents
   - Employee/contractor departures
   - Suspected key exposure

3. **Environment Separation**: Use different API keys for staging and production

4. **Monitoring**: Review logs regularly for:
   - Failed authentication attempts
   - Unusual request patterns
   - Geographic anomalies (via `cf-connecting-ip` header)

5. **HTTPS Only**: Always use HTTPS in production (Cloudflare provides this automatically)

6. **Rate Limiting**: Consider implementing additional rate limiting at the Cloudflare level

### Logging

The authentication middleware logs the following events:

- **Info**: Successful authenticated requests
- **Warning**: Missing or invalid API keys (includes IP address from `cf-connecting-ip` header)

Example log entries:

```json
{
  "level": "info",
  "message": "Authenticated API request",
  "path": "/crawl/cities",
  "method": "POST"
}
```

```json
{
  "level": "warn",
  "message": "API request with invalid X-API-Key",
  "path": "/crawl/cities",
  "method": "POST",
  "ip": "203.0.113.42"
}
```

### Limitations

This is a simple API key authentication mechanism suitable for:
- Internal services
- Trusted clients
- Low-to-medium security requirements

For higher security requirements, consider:
- JWT tokens with expiration
- OAuth 2.0 / OpenID Connect
- Cloudflare Access (Zero Trust)
- Request signing (HMAC)

### Migration Path

To enable authentication on an existing deployment without breaking clients:

1. **Phase 1**: Deploy with API_KEY unset (backward compatible)
2. **Phase 2**: Distribute API keys to clients
3. **Phase 3**: Set API_KEY in production (enable authentication)
4. **Phase 4**: Monitor logs for failed authentication attempts
5. **Phase 5**: Support legacy clients or enforce authentication fully

### Troubleshooting

#### Issue: Getting 401 errors after deployment

**Solution**: Verify the `X-API-Key` header is being sent correctly:

```bash
# Check what headers are being sent
curl -v https://goodfellow-prod.qconcursos.workers.dev/spiders \
  -H "X-API-Key: your-key"
```

#### Issue: Root endpoint shows `authEnabled: true` but no API_KEY was set

**Solution**: Check if the environment variable is set:

```bash
# List all secrets
wrangler secret list --config wrangler.jsonc

# Delete the secret if it shouldn't be there
wrangler secret delete API_KEY --config wrangler.jsonc
```

#### Issue: API key works locally but not in production

**Solution**: Ensure the secret is set in the correct environment:

```bash
wrangler secret put API_KEY --config wrangler.jsonc --env production
```

### Future Enhancements

Potential improvements to consider:

1. **Multiple API Keys**: Support for different clients with different keys
2. **Key Metadata**: Associate keys with client names/IDs for better logging
3. **Scoped Permissions**: Different keys with different endpoint access levels
4. **Rate Limiting per Key**: Track usage per API key
5. **Key Expiration**: Automatic expiration of keys after a certain time
6. **Webhook Authentication**: Validate incoming webhook signatures

