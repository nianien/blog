/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  // 只在生产环境使用 basePath
  basePath: process.env.NODE_ENV === 'production' ? '' : '',
  // 只在生产环境使用 assetPrefix
  assetPrefix: process.env.NODE_ENV === 'production' ? '' : '',
}

module.exports = nextConfig 