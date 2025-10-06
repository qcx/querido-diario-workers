/**
 * R2 Server Worker - Serves PDFs from R2 bucket
 */

import { Hono } from 'hono';

export interface Env {
  GAZETTE_PDFS: R2Bucket;
}

const app = new Hono<{ Bindings: Env }>();

// Serve PDFs from R2
app.get('/*', async (c) => {
  const key = c.req.path.slice(1); // Remove leading slash
  
  if (!key) {
    return c.json({ error: 'No key provided' }, 400);
  }

  try {
    const object = await c.env.GAZETTE_PDFS.get(key);
    
    if (!object) {
      return c.json({ error: 'PDF not found' }, 404);
    }

    // Set appropriate headers
    const headers = new Headers();
    headers.set('Content-Type', 'application/pdf');
    headers.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    
    if (object.httpMetadata?.contentType) {
      headers.set('Content-Type', object.httpMetadata.contentType);
    }

    return new Response(object.body, { headers });
  } catch (error: any) {
    console.error('Error serving PDF:', error);
    return c.json({ error: 'Internal server error' }, 500);
  }
});

export default app;

