# Dashboard Quick Start

## Installation & Deployment

### 1. Install Dependencies

```bash
npm install
```

This will install:
- React 18.3
- React Router 7
- Tailwind CSS
- All necessary TypeScript types

### 2. Verify Configuration

```bash
npm run type-check
```

Should complete without errors.

### 3. Test Locally

```bash
npm run dev
```

Then visit: `http://localhost:8787/dashboard`

**Note:** You'll need to set the API_KEY if testing authentication:

```bash
# In .dev.vars file
API_KEY=your-test-api-key
```

Then include it in your requests:

```bash
curl -H "X-API-Key: your-test-api-key" http://localhost:8787/dashboard
```

### 4. Deploy to Production

```bash
npm run deploy
```

The dashboard will be available at: `https://your-worker.workers.dev/dashboard`

## Dashboard Pages

Once deployed, you can access:

| Page | URL | Purpose |
|------|-----|---------|
| Overview | `/dashboard` | System health and key metrics |
| Crawl Progress | `/dashboard/crawl-progress` | Monitor crawl jobs |
| Errors | `/dashboard/errors` | View and track errors |
| Telemetry | `/dashboard/telemetry` | Performance metrics |
| Gazettes | `/dashboard/gazettes` | Gazette registry |
| OCR | `/dashboard/ocr` | OCR job status |
| Webhooks | `/dashboard/webhooks` | Webhook deliveries |
| Concursos | `/dashboard/concursos` | Competition findings |

## Authentication

All dashboard routes are protected by the existing API key middleware.

**To access:**

1. **Via Browser:** Configure your browser to send the `X-API-Key` header (use browser extension)
2. **Via API:** Include the header in requests:
   ```bash
   curl -H "X-API-Key: your-api-key" https://your-worker.workers.dev/dashboard
   ```

**To set/update API key:**

```bash
# For development
echo "API_KEY=your-dev-key" >> .dev.vars

# For production
wrangler secret put API_KEY
# Then enter your production key when prompted
```

## Troubleshooting

### Dashboard Returns 401 Unauthorized

**Solution:** Set or provide the API_KEY

```bash
wrangler secret put API_KEY
```

### Dashboard Shows "Error Loading Dashboard"

**Check:**
1. Database binding configured in `wrangler.jsonc`
2. D1 database exists and is accessible
3. Cloudflare Workers logs for details

### Data Not Showing

**Verify:**
1. Database has data: `npm run db:studio`
2. Check `/dashboard/errors` page for issues
3. Review browser console for JavaScript errors

### Styles Not Loading

**Ensure:**
1. Tailwind CDN is accessible
2. HTML template includes the script tag
3. No content security policy blocking CDN

## Features Overview

### What You Get

✅ **8 Complete Dashboard Pages** - Full monitoring coverage  
✅ **Server-Side Rendering** - Fast initial load  
✅ **React Router 7** - Modern routing with loaders  
✅ **Tailwind CSS** - Beautiful, responsive design  
✅ **API Key Protection** - Secure by default  
✅ **Real Database Queries** - Direct D1 access  
✅ **Type-Safe** - Full TypeScript support  
✅ **Mobile Responsive** - Works on all devices  

### Key Capabilities

📊 **Monitor Pipeline** - Track crawls from start to finish  
❌ **Error Tracking** - Identify and resolve issues quickly  
📈 **Performance Metrics** - Optimize spider execution  
📰 **Gazette Registry** - View all collected gazettes  
📝 **OCR Status** - Monitor text extraction  
🔔 **Webhook Logs** - Track delivery success  
🎓 **Concurso Findings** - Analyze competition data  

## Next Steps

### For Development

1. **Explore the Code:**
   - Components: `src/dashboards/components/`
   - Pages: `src/dashboards/pages/`
   - Data: `src/dashboards/services/dashboard-data.ts`

2. **Customize:**
   - Add new pages (see `docs/DASHBOARD_GUIDE.md`)
   - Modify components
   - Add new metrics

3. **Test:**
   - Follow `docs/DASHBOARD_TESTING.md`
   - Verify all functionality
   - Check mobile responsiveness

### For Production

1. **Deploy:**
   ```bash
   npm run deploy
   ```

2. **Monitor:**
   - Check Cloudflare Workers Analytics
   - Review error logs at `/dashboard/errors`
   - Track response times

3. **Maintain:**
   - Update dependencies monthly
   - Review security advisories
   - Monitor performance

## Documentation

- **User Guide:** `docs/DASHBOARD_GUIDE.md` - Complete features and usage
- **Testing Guide:** `docs/DASHBOARD_TESTING.md` - Testing procedures
- **Implementation:** `DASHBOARD_IMPLEMENTATION.md` - Technical details

## Support

If you encounter issues:

1. Check the documentation files above
2. Review `/dashboard/errors` for application errors
3. Check Cloudflare Workers logs
4. Verify database connection with `npm run db:studio`

## Architecture

```
User Request
    ↓
Hono Middleware (API Key Check)
    ↓
Dashboard Routes (/dashboard/*)
    ↓
React Router Loader (Server-Side)
    ↓
Drizzle ORM Query
    ↓
D1 Database
    ↓
SSR (React renderToString)
    ↓
HTML Response
    ↓
Client Hydration (React Router)
    ↓
Interactive Dashboard
```

## Technology Stack

- **Runtime:** Cloudflare Workers
- **Server:** Hono
- **Frontend:** React 18.3
- **Routing:** React Router 7
- **Styling:** Tailwind CSS
- **Database:** D1 (SQLite)
- **ORM:** Drizzle
- **Language:** TypeScript

## Success Criteria

✅ All 8 pages load without errors  
✅ API key protection works  
✅ Data displays correctly  
✅ Responsive on mobile  
✅ No console errors  
✅ Performance < 2s load time  

## Getting Help

**Resources:**
- React Router: https://reactrouter.com/
- Tailwind CSS: https://tailwindcss.com/
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Drizzle ORM: https://orm.drizzle.team/

**Common Commands:**
```bash
npm run dev              # Start dev server
npm run deploy           # Deploy to production
npm run type-check       # Check TypeScript
npm run db:studio        # Open database GUI
wrangler tail            # View live logs
```

---

**That's it!** Your dashboard is ready to use. Navigate to `/dashboard` and start monitoring your gazette processing pipeline. 🎉

