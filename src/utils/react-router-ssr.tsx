import React from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import App from '../components/App';

export function renderReactRouterPage(url: string, title = 'Goodfellow'): string {
  const html = renderToString(
    <StaticRouter location={url}>
      <App />
    </StaticRouter>
  );
  
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <style>
      * {
        box-sizing: border-box;
      }
      body { 
        margin: 0; 
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
          'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
          sans-serif;
        -webkit-font-smoothing: antialiased;
        -moz-osx-font-smoothing: grayscale;
      }
      a { 
        color: #0066cc; 
        text-decoration: none; 
      }
      a:hover { 
        background: rgba(255, 255, 255, 0.1);
      }
      h1, h2, h3 {
        color: #2c3e50;
      }
    </style>
  </head>
  <body>
    <div id="root">${html}</div>
  </body>
</html>
  `.trim();
}

