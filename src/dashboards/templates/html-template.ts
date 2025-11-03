/**
 * HTML template for SSR dashboard pages
 */

export function createHtmlTemplate(content: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Querido Diário Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            primary: {
              50: '#eff6ff',
              100: '#dbeafe',
              200: '#bfdbfe',
              300: '#93c5fd',
              400: '#60a5fa',
              500: '#3b82f6',
              600: '#2563eb',
              700: '#1d4ed8',
              800: '#1e40af',
              900: '#1e3a8a',
            },
          },
        },
      },
    }
  </script>
  <style>
    /* Custom scrollbar styles */
    .scrollbar-thin::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    
    .scrollbar-thin::-webkit-scrollbar-track {
      background-color: #f3f4f6;
    }
    
    .scrollbar-thin::-webkit-scrollbar-thumb {
      background-color: #9ca3af;
      border-radius: 9999px;
    }
    
    .scrollbar-thin::-webkit-scrollbar-thumb:hover {
      background-color: #6b7280;
    }
  </style>
</head>
<body>
  <div id="root">${content}</div>
</body>
</html>`;
}

