export const SITE = {
  url: 'https://www.skyfalling.cn',
  name: 'Skyfalling',
  title: 'Skyfalling',
  description: '分享技术、生活和思考的个人博客',
  author: 'Skyfalling',
  locale: 'zh-CN',
  defaultOgImage: '/og-default.png',
} as const;

export function absoluteUrl(path: string): string {
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${SITE.url}${p}`;
}
