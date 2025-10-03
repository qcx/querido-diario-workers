#!/bin/bash

# Setup script for Querido Diário Workers
# This script helps you set up the project for the first time

set -e

echo "🚀 Querido Diário Workers - Setup Script"
echo "=========================================="
echo ""

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

echo "✅ Node.js version: $(node --version)"

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install npm first."
    exit 1
fi

echo "✅ npm version: $(npm --version)"

# Check if wrangler is installed
if ! command -v wrangler &> /dev/null; then
    echo "⚠️  Wrangler CLI is not installed globally."
    echo "   Installing wrangler locally..."
    npm install -D wrangler
else
    echo "✅ Wrangler version: $(wrangler --version)"
fi

echo ""
echo "📦 Installing dependencies..."
npm install

echo ""
echo "🔧 Building TypeScript..."
npm run build

echo ""
echo "🔐 Checking Cloudflare authentication..."
if wrangler whoami &> /dev/null; then
    echo "✅ Already authenticated with Cloudflare"
else
    echo "⚠️  Not authenticated with Cloudflare"
    echo "   Run: wrangler login"
fi

echo ""
echo "📋 Creating .dev.vars file..."
if [ ! -f .dev.vars ]; then
    cp .dev.vars.example .dev.vars
    echo "✅ Created .dev.vars (edit this file with your values)"
else
    echo "⚠️  .dev.vars already exists (skipping)"
fi

echo ""
echo "🎯 Next steps:"
echo ""
echo "1. Authenticate with Cloudflare (if not done):"
echo "   wrangler login"
echo ""
echo "2. Create the queues:"
echo "   npm run queue:create"
echo "   npm run queue:create:dlq"
echo ""
echo "3. Test locally:"
echo "   npm run dev          # Start dispatcher"
echo "   npm run dev:consumer # Start consumer (in another terminal)"
echo ""
echo "4. Run tests:"
echo "   npm test"
echo ""
echo "5. Deploy to Cloudflare:"
echo "   npm run deploy:all"
echo ""
echo "✨ Setup complete! Check DEPLOYMENT.md for more details."
