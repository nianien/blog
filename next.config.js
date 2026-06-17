/** @type {import('next').NextConfig} */
const isExport = process.env.NEXT_EXPORT === 'true';

const nextConfig = {
  // 静态导出
  ...(isExport && { output: 'export' }),

  // 单页生成超时（秒）。页面多、构建机器较弱时（如 CF Pages）默认 60s 易超时
  staticPageGenerationTimeout: 300,

  // 保留 / 结尾（静态站必须）
  trailingSlash: true,

  // 关闭 Next.js 内置 Image 优化（静态导出必须）
  images: { unoptimized: true },

  // 如果 basePath 生产环境才需要，可直接用变量控制
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || '',

  // 同理 assetPrefix
  assetPrefix: process.env.NEXT_PUBLIC_ASSET_PREFIX || '',
}

module.exports = nextConfig;