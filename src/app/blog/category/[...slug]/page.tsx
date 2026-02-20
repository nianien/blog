import { redirect } from 'next/navigation';
import { getPostsByCategory, getAllCategories } from '@/lib/blog';
import { CATEGORY_META, MAIN_CATEGORIES } from '@/lib/categories';
import BlogCard from '@/components/BlogCard';
import CategoryNav from '@/components/CategoryNav';
import Link from 'next/link';
import type { Metadata } from 'next';

const POSTS_PER_PAGE = 18;

// Parse slug segments into categoryPath and page number
// e.g. ["engineering", "agentic", "page", "1"] → { categoryPath: "engineering/agentic", page: 1 }
// e.g. ["engineering", "page", "1"] → { categoryPath: "engineering", page: 1 }
// e.g. ["engineering"] → redirect needed
function parseSlug(slug: string[]): { categoryPath: string; page: number } | null {
  const pageIndex = slug.indexOf('page');
  if (pageIndex === -1) {
    return null; // needs redirect
  }
  const categoryPath = slug.slice(0, pageIndex).join('/');
  const page = parseInt(slug[pageIndex + 1]) || 1;
  return { categoryPath, page };
}

export async function generateStaticParams() {
  const categories = getAllCategories();
  const params: Array<{ slug: string[] }> = [];

  // Sub-category pages
  for (const cat of categories) {
    const posts = getPostsByCategory(cat.path);
    const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
    const parts = cat.path.split('/');
    for (let page = 1; page <= totalPages; page++) {
      params.push({ slug: [...parts, 'page', String(page)] });
    }
    // Bare path redirect entry
    params.push({ slug: parts });
  }

  // Main category pages
  for (const main of MAIN_CATEGORIES) {
    const posts = getPostsByCategory(main);
    const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
    for (let page = 1; page <= totalPages; page++) {
      params.push({ slug: [main, 'page', String(page)] });
    }
    // Bare path redirect entry
    params.push({ slug: [main] });
  }

  return params;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const parsed = parseSlug(slug);
  const categoryPath = parsed?.categoryPath || slug.join('/');
  const meta = CATEGORY_META[categoryPath];
  const name = meta?.name || categoryPath;

  return {
    title: `${name} - Skyfalling Blog`,
    description: meta?.description || `${name}分类下的文章`,
  };
}

export default async function CategoryPage({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const parsed = parseSlug(slug);

  // If no /page/N in URL, redirect to page 1
  if (!parsed) {
    const categoryPath = slug.join('/');
    redirect(`/blog/category/${categoryPath}/page/1`);
  }

  const { categoryPath, page: currentPage } = parsed;

  const allPostsForCategory = getPostsByCategory(categoryPath);
  const totalPosts = allPostsForCategory.length;
  const totalPages = Math.ceil(totalPosts / POSTS_PER_PAGE);
  const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
  const endIndex = startIndex + POSTS_PER_PAGE;
  const posts = allPostsForCategory.slice(startIndex, endIndex);

  const meta = CATEGORY_META[categoryPath];
  const categoryName = meta?.name || categoryPath;
  const categoryDescription = meta?.description || '';

  return (
    <div className="bg-[var(--background)] pt-8 pb-24 sm:pt-12 sm:pb-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            {categoryName}
          </h1>
          {categoryDescription && (
            <p className="mt-2 text-lg leading-8 text-gray-600">
              {categoryDescription}
            </p>
          )}
          <p className="mt-4 text-sm text-gray-500">
            共 {totalPosts} 篇文章
          </p>
        </div>
        {/* Category Navigation */}
        <CategoryNav currentCategory={categoryPath} />
        {/* Posts grid */}
        {posts.length > 0 ? (
          <div className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-x-8 gap-y-20 lg:mx-0 lg:max-w-none lg:grid-cols-3">
            {posts.map((post) => (
              <BlogCard key={post.slug} post={post} currentCategory={categoryPath} />
            ))}
          </div>
        ) : (
          <div className="mx-auto mt-16 max-w-2xl text-center">
            <p className="text-lg text-gray-600">该分类下暂无文章</p>
            <Link
              href="/blog/page/1"
              className="mt-4 inline-flex items-center text-blue-600 hover:text-blue-500"
            >
              返回所有文章
            </Link>
          </div>
        )}
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mx-auto mt-16 max-w-4xl">
            <div className="flex items-center justify-center space-x-2">
              {currentPage > 1 && (
                <Link
                  href={`/blog/category/${categoryPath}/page/${currentPage - 1}`}
                  className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                >
                  上一页
                </Link>
              )}
              <div className="flex space-x-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                  <Link
                    key={pageNum}
                    href={`/blog/category/${categoryPath}/page/${pageNum}`}
                    className={`rounded-md px-3 py-2 text-sm font-semibold ${
                      pageNum === currentPage
                        ? 'bg-blue-600 text-white'
                        : 'bg-white text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    {pageNum}
                  </Link>
                ))}
              </div>
              {currentPage < totalPages && (
                <Link
                  href={`/blog/category/${categoryPath}/page/${currentPage + 1}`}
                  className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                >
                  下一页
                </Link>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
