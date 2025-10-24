import React from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import App from '../components/App';

export function renderReactRouterPage(url: string, title = 'Goodfellow', loaderData?: any): string {
  const html = renderToString(
    <StaticRouter location={url}>
      <App />
    </StaticRouter>
  );
  
  // Serialize loader data for client hydration
  const serializedData = loaderData ? JSON.stringify(loaderData) : '{}';
  
  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            colors: {
              primary: {
                50: '#f0f9ff',
                100: '#e0f2fe',
                200: '#bae6fd',
                300: '#7dd3fc',
                400: '#38bdf8',
                500: '#0ea5e9',
                600: '#0284c7',
                700: '#0369a1',
                800: '#075985',
                900: '#0c4a6e',
              },
            },
          },
        },
      }
    </script>
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
        background-color: #f9fafb;
      }
      a { 
        text-decoration: none; 
      }
    </style>
  </head>
  <body>
    <div id="root">${html}</div>
    <script>
      window.__INITIAL_DATA__ = ${serializedData};
    </script>
  </body>
</html>
  `.trim();
}

