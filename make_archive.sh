#!/bin/bash
tar --exclude='node_modules' \
    --exclude='.next' \
    --exclude='.git' \
    --exclude='.vercel' \
    --exclude='*.log' \
    --exclude='*.tar' \
    --exclude='*.tar.gz' \
    --exclude='.env' \
    --exclude='.env.local' \
    --exclude='.env*.local' \
    --exclude='.env.production*' \
    --exclude='.env.development*' \
    --exclude='pnpm-lock.yaml' \
    --exclude='public' \
    --exclude='next-env.d.ts' \
    -czvf ~/Downloads/jalal_source.tar.gz .

echo "✅ Archive created: ~/Downloads/jalal_source.tar.gz"
