# Dashboard Guide

## Overview

The Querido Diário Dashboard is a comprehensive monitoring system built with React, React Router 7, and Tailwind CSS. It provides real-time insights into the gazette processing pipeline with server-side rendering (SSR) for optimal performance.

## Features

### 8 Dashboard Pages

1. **Overview** (`/dashboard`)
   - System health at a glance
   - Key metrics (total gazettes, active jobs, errors, OCR success rate)
   - Pipeline status (OCR, webhooks, concursos)
   - Recent activity timeline

2. **Crawl Progress** (`/dashboard/crawl-progress`)
   - List of all crawl jobs with status
   - Progress indicators for each job
   - Success/failure rates per city
   - Job duration tracking

3. **Errors** (`/dashboard/errors`)
   - Error logs by severity (warning, error, critical)
   - Unresolved errors highlighted
   - Filterable error table
   - Error context (worker, operation, territory)

4. **Telemetry** (`/dashboard/telemetry`)
   - Performance metrics by spider type
   - Pipeline step statistics
   - Success rates and execution times
   - Recent telemetry activity

5. **Gazettes** (`/dashboard/gazettes`)
   - Gazette registry with status
   - OCR and analysis completion indicators
   - PDF links
   - Publication date filtering

6. **OCR** (`/dashboard/ocr`)
   - OCR job queue status
   - Processing statistics
   - Success/failure breakdown
   - Average processing time and text length

7. **Webhooks** (`/dashboard/webhooks`)
   - Webhook delivery logs
   - Success/retry/failure rates
   - HTTP status codes
   - Attempt tracking

8. **Concursos** (`/dashboard/concursos`)
   - Public competition findings
   - Total vagas (job openings) tracked
   - Confidence scores
   - Extraction method breakdown

## Architecture

### Technology Stack

- **Frontend**: React 18.3 with TypeScript
- **Routing**: React Router 7 with SSR
- **Styling**: Tailwind CSS (via CDN)
- **Backend**: Hono (Cloudflare Workers)
- **Database**: D1 (SQLite) with Drizzle ORM
- **Rendering**: Server-side rendering with client hydration

### Data Flow

```
User Request → Hono Route → React Router Loader → Drizzle Query → D1 Database
                                    ↓
                           Server-side Render → HTML Response
                                    ↓
                           Client Hydration → Interactive UI
```

### Authentication

All dashboard routes are protected by the existing API key middleware. To access:

1. Include `X-API-Key` header with your API key
2. Or configure API key access in your Cloudflare Workers settings

## Installation

The dashboard is already integrated into the Goodfellow worker. To deploy:

```bash
# Install dependencies
npm install

# Deploy to Cloudflare
npm run deploy
```

## Usage

### Accessing the Dashboard

1. **Production**: `https://your-worker.workers.dev/dashboard`
2. **Development**: `http://localhost:8787/dashboard`

### Navigation

Use the sidebar to navigate between dashboard pages. All data is loaded server-side via React Router loaders.

### Data Refresh

Dashboard data is loaded on each page navigation. To see updated data:
- Navigate to another page and back
- Refresh the browser page

## Components

### Reusable Components

Located in `src/dashboards/components/`:

- **Card**: Container for dashboard sections
- **StatCard**: Display key metrics with icons
- **Table**: Sortable, responsive data tables
- **StatusBadge**: Color-coded status indicators
- **ProgressBar**: Visual progress indicators
- **LoadingSpinner**: Loading states
- **ErrorAlert**: Error messages with severity levels

### Layout

Located in `src/dashboards/layout.tsx`:

- Responsive sidebar navigation
- Header with branding
- Main content area
- Mobile-friendly design

## Data Services

Located in `src/dashboards/services/dashboard-data.ts`:

### Available Functions

- `getOverviewStats()`: System-wide statistics
- `getRecentCrawlJobs()`: Crawl job list with progress
- `getErrorLogs()`: Error logs with filtering
- `getTelemetryStats()`: Performance metrics
- `getGazettes()`: Gazette registry
- `getOcrJobStats()`: OCR processing stats
- `getWebhookStats()`: Webhook delivery stats
- `getConcursos()`: Concurso findings

All functions use Drizzle ORM for type-safe database queries.

## Customization

### Adding a New Dashboard Page

1. Create the page component in `src/dashboards/pages/`:

```typescript
import React from 'react';
import { useLoaderData } from 'react-router-dom';
import type { LoaderFunctionArgs } from 'react-router-dom';
import { DashboardLayout } from '../layout';
import { getDatabase } from '../../services/database';

export async function loader({ context }: LoaderFunctionArgs) {
  const db = getDatabase(context.env as any);
  // Fetch your data
  return { data };
}

export function MyPage() {
  const { data } = useLoaderData<{ data: any }>();
  
  return (
    <DashboardLayout currentPath="/dashboard/my-page">
      {/* Your content */}
    </DashboardLayout>
  );
}
```

2. Add the route to `src/dashboards/router.tsx`:

```typescript
import { MyPage, loader as myLoader } from './pages/my-page';

export const dashboardRoutes: RouteObject[] = [
  // ... existing routes
  {
    path: '/dashboard/my-page',
    element: <MyPage />,
    loader: myLoader,
  },
];
```

3. Add navigation link to `src/dashboards/layout.tsx`:

```typescript
const navItems = [
  // ... existing items
  { path: '/dashboard/my-page', label: 'My Page', icon: '📊' },
];
```

### Styling

Tailwind CSS classes are available throughout. Custom styles can be added to `src/dashboards/styles.css`.

### Formatting

Utility functions in `src/dashboards/utils/formatters.ts`:

- `formatDate()`: Format ISO dates to PT-BR format
- `formatDuration()`: Convert milliseconds to human-readable
- `formatPercentage()`: Format numbers as percentages
- `getStatusColor()`: Get Tailwind class for status
- `getSeverityColor()`: Get Tailwind class for severity

## Performance

### Optimization Strategies

1. **Server-side Rendering**: Initial HTML includes all data
2. **Client Hydration**: Minimal JavaScript for interactivity
3. **Database Indexes**: All queries use indexed columns
4. **Efficient Queries**: Aggregations done at database level
5. **Limited Results**: Default limits on large datasets

### Monitoring

The dashboard itself can be monitored through:
- Browser DevTools (Network, Performance tabs)
- Cloudflare Workers Analytics
- Error logs in `/dashboard/errors`

## Troubleshooting

### Dashboard Not Loading

1. Check API key is configured: `wrangler secret put API_KEY`
2. Verify database binding in `wrangler.jsonc`
3. Check browser console for errors
4. Verify D1 database is accessible

### Data Not Showing

1. Verify database has data (use `npm run db:studio`)
2. Check error logs: `/dashboard/errors`
3. Inspect network tab for failed requests
4. Review Cloudflare Workers logs

### Styling Issues

1. Ensure Tailwind CDN is loading (check Network tab)
2. Clear browser cache
3. Verify HTML template includes Tailwind script

### Performance Issues

1. Check database query performance in D1
2. Add database indexes if needed
3. Reduce data limits in loaders
4. Consider caching frequently accessed data

## Development

### Local Development

```bash
# Start dev server
npm run dev

# Access dashboard
open http://localhost:8787/dashboard
```

### Type Checking

```bash
# Check types
npm run type-check

# Watch mode
npm run type-check -- --watch
```

### Database Studio

```bash
# Local database
npm run db:studio:local

# Production database
npm run db:studio
```

## Security

### Access Control

- All dashboard routes require API key authentication
- API key is validated by Hono middleware
- No public access without authentication

### Data Protection

- No sensitive data (secrets, API keys) exposed in client
- SQL injection prevented by Drizzle ORM
- Type-safe queries throughout

### Best Practices

1. Use environment variables for secrets
2. Regularly rotate API keys
3. Monitor error logs for suspicious activity
4. Keep dependencies updated

## Future Enhancements

Potential improvements:

1. **Real-time Updates**: Use WebSockets or Server-Sent Events
2. **Data Export**: CSV/JSON download functionality
3. **Date Range Filtering**: Custom date range selection
4. **Dark Mode**: Theme switching
5. **Advanced Filtering**: More filter options per page
6. **Charts**: Interactive charts with D3.js or Chart.js
7. **Alerts**: Email/Slack notifications for critical errors
8. **User Management**: Multiple users with different permissions

## Support

For issues or questions:

1. Check error logs: `/dashboard/errors`
2. Review this documentation
3. Consult Cloudflare Workers docs
4. Check React Router 7 documentation

## License

Same as parent project (MIT).

