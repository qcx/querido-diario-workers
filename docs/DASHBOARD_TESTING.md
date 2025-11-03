# Dashboard Testing Guide

## Pre-deployment Checklist

Before deploying the dashboard, verify the following:

### 1. Dependencies Installed

```bash
npm install
```

Verify these packages are in `package.json`:
- react
- react-dom
- react-router
- react-router-dom
- tailwindcss
- autoprefixer
- postcss

### 2. TypeScript Configuration

```bash
npm run type-check
```

Should pass without errors.

### 3. Build Configuration

Verify these files exist:
- `tailwind.config.js`
- `postcss.config.js`
- `tsconfig.json` (with JSX enabled)

## Local Testing

### Start Development Server

```bash
npm run dev
# or
wrangler dev --config wrangler.jsonc
```

### Access Dashboard

Open in browser: `http://localhost:8787/dashboard`

### Test API Key Protection

1. **Without API Key** (should fail):
```bash
curl http://localhost:8787/dashboard
# Expected: 401 Unauthorized
```

2. **With API Key** (should succeed):
```bash
curl -H "X-API-Key: your-api-key" http://localhost:8787/dashboard
# Expected: HTML response
```

### Test Each Dashboard Page

Visit each route and verify:

1. **Overview** (`/dashboard`)
   - [ ] Page loads without errors
   - [ ] Statistics cards display numbers
   - [ ] Pipeline status shows OCR/Webhook/Concurso counts
   - [ ] Recent activity table populates

2. **Crawl Progress** (`/dashboard/crawl-progress`)
   - [ ] Crawl jobs table displays
   - [ ] Progress bars show correctly
   - [ ] Status badges have appropriate colors
   - [ ] Failed cities highlighted in red

3. **Errors** (`/dashboard/errors`)
   - [ ] Error summary cards show counts
   - [ ] Unresolved errors section appears (if any)
   - [ ] Error table displays with severity colors
   - [ ] Error messages truncate properly

4. **Telemetry** (`/dashboard/telemetry`)
   - [ ] Spider type performance table shows
   - [ ] Pipeline steps table displays
   - [ ] Success rates calculate correctly
   - [ ] Average execution times display

5. **Gazettes** (`/dashboard/gazettes`)
   - [ ] Status summary cards show counts
   - [ ] Gazette table displays
   - [ ] PDF links work
   - [ ] OCR/Analysis checkmarks show correctly

6. **OCR** (`/dashboard/ocr`)
   - [ ] OCR stats cards display
   - [ ] Status breakdown shows
   - [ ] Recent jobs table populates
   - [ ] Processing times format correctly

7. **Webhooks** (`/dashboard/webhooks`)
   - [ ] Webhook stats display
   - [ ] Status breakdown cards show
   - [ ] Recent deliveries table displays
   - [ ] HTTP status codes show with colors

8. **Concursos** (`/dashboard/concursos`)
   - [ ] Concurso stats display
   - [ ] Extraction methods breakdown shows
   - [ ] Concursos table populates
   - [ ] Confidence scores show with colors

## Functionality Testing

### Navigation

- [ ] Sidebar navigation works
- [ ] Active page highlighted in sidebar
- [ ] All links navigate correctly
- [ ] Browser back/forward buttons work

### Responsive Design

Test on different screen sizes:

- [ ] Desktop (1920x1080)
- [ ] Laptop (1366x768)
- [ ] Tablet (768x1024)
- [ ] Mobile (375x667)

Verify:
- [ ] Sidebar adapts on small screens
- [ ] Tables scroll horizontally when needed
- [ ] Cards stack properly on mobile
- [ ] Text remains readable at all sizes

### Data Loading

- [ ] Initial page load shows data
- [ ] Navigation between pages loads new data
- [ ] Empty states display when no data
- [ ] Loading states appear (if applicable)

### Error Handling

Test error scenarios:

1. **Invalid Route**:
   - Navigate to `/dashboard/invalid`
   - [ ] Shows error message or redirects

2. **Database Error**:
   - Temporarily break database connection
   - [ ] Shows user-friendly error
   - [ ] Doesn't expose sensitive info

3. **Network Error**:
   - Throttle network in DevTools
   - [ ] Page still loads (SSR)
   - [ ] Hydration handles slow connection

## Performance Testing

### Page Load Times

Use browser DevTools Performance tab:

- [ ] Initial HTML loads in < 1s
- [ ] Time to Interactive < 2s
- [ ] No long tasks blocking main thread

### Database Queries

Check query performance:

```bash
# Access D1 Studio
npm run db:studio:local

# Monitor slow queries
# Look for queries taking > 500ms
```

- [ ] All queries complete in < 500ms
- [ ] No N+1 query problems
- [ ] Aggregations done at database level

### Memory Usage

In DevTools Memory tab:

- [ ] No memory leaks on navigation
- [ ] Memory usage stable over time
- [ ] Heap size reasonable (< 50MB)

## Security Testing

### Authentication

- [ ] API key required for all dashboard routes
- [ ] Invalid API key returns 403
- [ ] Missing API key returns 401
- [ ] Root `/` endpoint exempt from auth

### Data Exposure

- [ ] No API keys in HTML source
- [ ] No secrets in client-side code
- [ ] Database connection not exposed
- [ ] Error messages don't reveal internals

### XSS Protection

- [ ] User input properly escaped
- [ ] HTML entities encoded
- [ ] Script injection prevented
- [ ] React's XSS protection active

## Accessibility Testing

### Keyboard Navigation

- [ ] Tab through all interactive elements
- [ ] Skip navigation available
- [ ] Focus indicators visible
- [ ] Enter/Space activate buttons

### Screen Reader

Test with screen reader (NVDA, JAWS, VoiceOver):

- [ ] Page structure announced
- [ ] Headings in logical order
- [ ] Tables have proper headers
- [ ] Status conveyed in text

### Color Contrast

- [ ] Text meets WCAG AA standards (4.5:1)
- [ ] Status colors distinguishable
- [ ] Interactive elements visible
- [ ] Focus states obvious

## Browser Compatibility

Test in multiple browsers:

- [ ] Chrome (latest)
- [ ] Firefox (latest)
- [ ] Safari (latest)
- [ ] Edge (latest)

Verify:
- [ ] Tailwind styles load
- [ ] React hydration works
- [ ] Navigation functions
- [ ] Tables scroll properly

## Production Deployment Testing

### Before Deployment

```bash
# Type check
npm run type-check

# Build (if needed)
npm run build

# Deploy to staging
wrangler deploy --config wrangler.jsonc --env development
```

### After Deployment

1. **Verify Production URL**:
```bash
curl -H "X-API-Key: prod-api-key" https://goodfellow-prod.workers.dev/dashboard
```

2. **Test Each Page**:
   - Visit all 8 dashboard pages
   - Verify data loads from production database
   - Check for any console errors

3. **Performance**:
   - Use Lighthouse to audit
   - Target scores: Performance > 90, Accessibility > 90

4. **Monitoring**:
   - Check Cloudflare Workers Analytics
   - Monitor error rates
   - Track response times

## Common Issues

### Dashboard Returns 500 Error

**Cause**: Server-side rendering error

**Fix**:
1. Check Cloudflare Workers logs
2. Verify database binding in `wrangler.jsonc`
3. Test loaders independently

### Styles Not Loading

**Cause**: Tailwind CDN blocked or failed

**Fix**:
1. Check browser console for CDN errors
2. Verify network connectivity
3. Consider self-hosting Tailwind

### Data Not Displaying

**Cause**: Database query error or empty database

**Fix**:
1. Check D1 database has data
2. Verify Drizzle schema matches database
3. Review query logic in data services

### Hydration Errors

**Cause**: Server/client HTML mismatch

**Fix**:
1. Ensure no random IDs generated server-side
2. Verify date formatting consistency
3. Check for conditional rendering issues

## Automated Testing (Future)

Consider adding:

1. **Unit Tests**: Jest + React Testing Library
2. **Integration Tests**: Playwright or Cypress
3. **Visual Regression**: Percy or Chromatic
4. **Load Testing**: k6 or Artillery
5. **Accessibility**: Axe or Pa11y

## Sign-off Checklist

Before marking dashboard as production-ready:

- [ ] All 8 pages tested
- [ ] API key protection verified
- [ ] Responsive on mobile/tablet/desktop
- [ ] No TypeScript errors
- [ ] No console errors
- [ ] Performance acceptable (< 2s load)
- [ ] Accessibility basics met
- [ ] Documentation complete
- [ ] Deployed to staging successfully
- [ ] Stakeholders reviewed

## Maintenance

### Regular Checks

- **Weekly**: Review error logs, check performance
- **Monthly**: Update dependencies, security audit
- **Quarterly**: Accessibility audit, UX review

### Monitoring

Set up alerts for:
- Dashboard errors > 5% of requests
- Response time > 3 seconds
- Failed database queries
- Auth failures spike

## Resources

- [React Router 7 Docs](https://reactrouter.com/)
- [Tailwind CSS Docs](https://tailwindcss.com/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Drizzle ORM Docs](https://orm.drizzle.team/)
- [WCAG Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)

