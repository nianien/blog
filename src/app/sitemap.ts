import type { MetadataRoute } from 'next';
import {
  getAllPosts,
  getAllTags,
  getAllCategories,
  getPostsByTag,
  getPostsByCategory,
} from '@/lib/blog';
import { MAIN_CATEGORIES } from '@/lib/categories';
import { SITE } from '@/lib/site';

const POSTS_PER_PAGE = 18;

// Next 在静态导出时只生成 sitemap.xml（不调用我们的 sitemap()）。
// 我们把 dynamic 设为 force-static，让 Next 在 build 时把 sitemap.ts 当静态文件产出。
export const dynamic = 'force-static';

function url(path: string): string {
  const p = path.endsWith('/') ? path : `${path}/`;
  return `${SITE.url}${p.startsWith('/') ? p : `/${p}`}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const posts = getAllPosts();
  const tags = getAllTags();
  const categories = getAllCategories();

  // 站点静态页
  const staticEntries: MetadataRoute.Sitemap = [
    { url: url('/'), lastModified: now, changeFrequency: 'daily', priority: 1.0 },
    { url: url('/about/'), lastModified: now, changeFrequency: 'monthly', priority: 0.5 },
    { url: url('/contact/'), lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
  ];

  // 文章页（最新 pubDate 当作 lastModified）
  const postEntries: MetadataRoute.Sitemap = posts.map((post) => ({
    url: url(`/blog/${encodeURI(post.slug)}/`),
    lastModified: new Date(post.pubDate),
    changeFrequency: 'monthly',
    priority: 0.8,
  }));

  // 文章列表分页
  const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
  const listEntries: MetadataRoute.Sitemap = Array.from(
    { length: totalPages },
    (_, i) => ({
      url: url(`/blog/page/${i + 1}/`),
      lastModified: now,
      changeFrequency: 'weekly',
      priority: i === 0 ? 0.9 : 0.5,
    })
  );

  // 主分类 + 子分类的分页
  const categoryEntries: MetadataRoute.Sitemap = [];
  const seenCategoryPages = new Set<string>();
  const pushCategoryPages = (categoryPath: string) => {
    const count = getPostsByCategory(categoryPath).length;
    const pages = Math.ceil(count / POSTS_PER_PAGE);
    for (let p = 1; p <= pages; p++) {
      const u = url(`/blog/category/${categoryPath}/page/${p}/`);
      if (seenCategoryPages.has(u)) continue;
      seenCategoryPages.add(u);
      categoryEntries.push({
        url: u,
        lastModified: now,
        changeFrequency: 'weekly',
        priority: p === 1 ? 0.7 : 0.4,
      });
    }
  };
  for (const main of MAIN_CATEGORIES) pushCategoryPages(main);
  for (const cat of categories) pushCategoryPages(cat.path);

  // 标签分页
  const tagEntries: MetadataRoute.Sitemap = [];
  for (const tag of tags) {
    const count = getPostsByTag(tag).length;
    const pages = Math.ceil(count / POSTS_PER_PAGE);
    for (let p = 1; p <= pages; p++) {
      tagEntries.push({
        url: url(`/blog/tag/${encodeURIComponent(tag)}/page/${p}/`),
        lastModified: now,
        changeFrequency: 'weekly',
        priority: p === 1 ? 0.6 : 0.3,
      });
    }
  }

  return [
    ...staticEntries,
    ...postEntries,
    ...listEntries,
    ...categoryEntries,
    ...tagEntries,
  ];
}
