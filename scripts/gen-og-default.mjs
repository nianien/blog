#!/usr/bin/env node
// 生成站点默认 OG 图（1200x630）。一次性脚本，文章不带 heroImage 时回退到此图。
// 用法：node scripts/gen-og-default.mjs

import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '../public/og-default.png');

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0F172A"/>
      <stop offset="100%" stop-color="#1E293B"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#3B82F6"/>
      <stop offset="100%" stop-color="#06B6D4"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- 左上角装饰 -->
  <circle cx="120" cy="120" r="160" fill="#3B82F6" opacity="0.08"/>
  <circle cx="1080" cy="510" r="200" fill="#06B6D4" opacity="0.08"/>

  <!-- 左上 brand mark -->
  <rect x="80" y="80" width="48" height="48" rx="10" fill="url(#accent)"/>
  <text x="148" y="115" font-family="system-ui, -apple-system, 'PingFang SC', sans-serif"
        font-size="28" font-weight="600" fill="#E2E8F0">Skyfalling</text>

  <!-- 主标题 -->
  <text x="80" y="320" font-family="system-ui, -apple-system, 'PingFang SC', sans-serif"
        font-size="84" font-weight="700" fill="#F8FAFC">Think ahead,</text>
  <text x="80" y="430" font-family="system-ui, -apple-system, 'PingFang SC', sans-serif"
        font-size="84" font-weight="700" fill="url(#accent)">see beyond.</text>

  <!-- 副标题 -->
  <text x="80" y="500" font-family="system-ui, -apple-system, 'PingFang SC', sans-serif"
        font-size="28" font-weight="400" fill="#94A3B8">分享技术、生活和思考的个人博客</text>

  <!-- 右下 URL -->
  <text x="1120" y="570" text-anchor="end" font-family="'SF Mono', Menlo, monospace"
        font-size="22" fill="#64748B">www.skyfalling.cn</text>
</svg>`;

await mkdir(dirname(outPath), { recursive: true });
await sharp(Buffer.from(svg))
  .png({ compressionLevel: 9 })
  .toFile(outPath);

console.log(`✅ Generated ${outPath}`);
