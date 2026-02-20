import Link from 'next/link';
import { getAllCategories } from '@/lib/blog';
import { CATEGORY_META, MAIN_CATEGORIES } from '@/lib/categories';

interface CategoryNavProps {
  currentCategory?: string;
}

export default function CategoryNav({ currentCategory }: CategoryNavProps) {
  const categories = getAllCategories();

  // 当前选中的主分类
  const activeMain = currentCategory?.split('/')[0] || '';

  // 计算主分类文章总数
  const mainCounts: Record<string, number> = {};
  for (const cat of categories) {
    mainCounts[cat.main] = (mainCounts[cat.main] || 0) + cat.count;
  }

  // 当前主分类下的子分类
  const subCategories = activeMain
    ? categories.filter((c) => c.main === activeMain && c.sub)
    : [];

  return (
    <nav className="mx-auto mt-8 max-w-4xl">
      {/* 一级导航 */}
      <div className="flex flex-wrap gap-2 justify-center">
        <Link
          href="/blog/page/1"
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            !currentCategory
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          全部
        </Link>
        {MAIN_CATEGORIES.map((key) => {
          const meta = CATEGORY_META[key];
          const count = mainCounts[key] || 0;
          const isActive = activeMain === key;
          return (
            <Link
              key={key}
              href={`/blog/category/${key}/page/1`}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {meta?.name || key}
              <span className="ml-1 text-xs opacity-70">({count})</span>
            </Link>
          );
        })}
      </div>

      {/* 二级导航 */}
      {subCategories.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center mt-3">
          {subCategories.map((cat) => {
            const isActive = currentCategory === cat.path;
            return (
              <Link
                key={cat.path}
                href={`/blog/category/${cat.path}/page/1`}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-50 text-gray-600 hover:bg-gray-100'
                }`}
              >
                {cat.name}
                <span className="ml-1 opacity-70">({cat.count})</span>
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );
}
