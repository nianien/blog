import Link from 'next/link';
import { getAllPosts, getPostsByCategory, getAllCategories } from '@/lib/blog';
import { CATEGORY_META, MAIN_CATEGORIES } from '@/lib/categories';
import BlogCard from '@/components/BlogCard';

export default function Home() {
  const latestPosts = getAllPosts().slice(0, 6);
  const categories = getAllCategories();

  // 计算每个主分类的文章数
  const mainCounts: Record<string, number> = {};
  for (const cat of categories) {
    mainCounts[cat.main] = (mainCounts[cat.main] || 0) + cat.count;
  }

  return (
    <div className="bg-[var(--background)]">
      {/* Four quadrants section */}
      <div className="mx-auto max-w-7xl px-6 pt-8 sm:pt-12 lg:px-8">
        <h1 className="text-center text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl mb-10">
          Think ahead, see beyond
        </h1>
        <div className="mx-auto mt-4 grid max-w-2xl grid-cols-1 gap-6 sm:grid-cols-2 lg:mx-0 lg:max-w-none lg:grid-cols-4">
          {MAIN_CATEGORIES.map((key) => {
            const meta = CATEGORY_META[key];
            const count = mainCounts[key] || 0;
            // 每个板块取最新 1 篇文章作为预览
            const preview = count > 0 ? getPostsByCategory(key).slice(0, 1) : [];
            return (
              <Link
                key={key}
                href={`/blog/category/${key}/page/1`}
                className="group relative flex flex-col rounded-2xl border border-gray-200 p-6 hover:border-blue-300 hover:shadow-lg transition-all duration-200"
              >
                <h3 className="text-lg font-bold text-gray-900 group-hover:text-blue-600 transition-colors">
                  {meta?.name || key}
                </h3>
                <p className="mt-2 text-sm text-gray-500 flex-auto">
                  {meta?.description || ''}
                </p>
                {preview.length > 0 && (
                  <p className="mt-4 text-xs text-gray-400 line-clamp-2 border-t border-gray-100 pt-3">
                    最新: {preview[0].title}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between">
                  <span className="text-xs text-gray-400">{count} 篇文章</span>
                  <span className="text-sm text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                    &rarr;
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Latest posts section */}
      <div className="mx-auto mt-24 max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl lg:mx-0">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">最新文章</h2>
        </div>
        <div className="mx-auto mt-12 grid max-w-2xl grid-cols-1 gap-x-8 gap-y-16 lg:mx-0 lg:max-w-none lg:grid-cols-3">
          {latestPosts.map((post) => (
            <BlogCard key={post.slug} post={post} />
          ))}
        </div>
        <div className="mt-12 mb-16 flex justify-center">
          <Link
            href="/blog"
            className="rounded-md bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            查看所有文章
          </Link>
        </div>
      </div>
    </div>
  );
}
