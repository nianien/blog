import { getAllPosts, getAllTags } from '@/lib/blog';
import BlogCard from '@/components/BlogCard';
import Link from 'next/link';

const POSTS_PER_PAGE = 18;

export async function generateStaticParams() {
  const allPosts = getAllPosts();
  const totalPages = Math.ceil(allPosts.length / POSTS_PER_PAGE);
  return Array.from({ length: totalPages }, (_, i) => ({ page: String(i + 1) }));
}

export default async function BlogPage({ params }: { params: Promise<{ page: string }> }) {
  const resolvedParams = await params;
  const currentPage = resolvedParams.page ? parseInt(resolvedParams.page) : 1;
  const allPosts = getAllPosts();
  const tags = getAllTags();
  const totalPosts = allPosts.length;
  const totalPages = Math.ceil(totalPosts / POSTS_PER_PAGE);
  const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
  const endIndex = startIndex + POSTS_PER_PAGE;
  const posts = allPosts.slice(startIndex, endIndex);

  return (
    <div className="bg-[var(--background)] pt-8 pb-24 sm:pt-12 sm:pb-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            博客文章
          </h1>
          <p className="mt-2 text-lg leading-8 text-gray-600">
            分享技术见解、生活感悟和深度思考
          </p>
          <p className="mt-4 text-sm text-gray-500">
            共 {totalPosts} 篇文章
          </p>
        </div>
        {/* Tags */}
        <div className="mx-auto mt-8 max-w-4xl">
          <div className="flex flex-wrap gap-2 justify-center">
            <Link
              href="/blog/page/1"
              className="rounded-full bg-blue-600 px-3 py-1 text-sm font-medium text-white"
            >
              全部
            </Link>
            {tags.map((tag) => (
              <Link
                key={tag}
                href={`/blog/tag/${encodeURIComponent(tag)}/page/1`}
                className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200"
              >
                {tag}
              </Link>
            ))}
          </div>
        </div>
        {/* Posts grid */}
        <div className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-x-8 gap-y-20 lg:mx-0 lg:max-w-none lg:grid-cols-3">
          {posts.map((post) => (
            <BlogCard key={post.slug} post={post} />
          ))}
        </div>
        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mx-auto mt-16 max-w-4xl">
            <div className="flex items-center justify-center space-x-2">
              {/* Previous page */}
              {currentPage > 1 && (
                <Link
                  href={`/blog/page/${currentPage - 1}`}
                  className="rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
                >
                  上一页
                </Link>
              )}
              {/* Page numbers */}
              <div className="flex space-x-1">
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
                  <Link
                    key={pageNum}
                    href={`/blog/page/${pageNum}`}
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
              {/* Next page */}
              {currentPage < totalPages && (
                <Link
                  href={`/blog/page/${currentPage + 1}`}
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