import { getPostsByTag, getAllTags } from '@/lib/blog';
import BlogCard from '@/components/BlogCard';
import Link from 'next/link';

const POSTS_PER_PAGE = 18;

export async function generateStaticParams() {
  const tags = getAllTags();
  const params = [];
  
  for (const tag of tags) {
    const posts = getPostsByTag(tag);
    const totalPages = Math.ceil(posts.length / POSTS_PER_PAGE);
    
    for (let page = 1; page <= totalPages; page++) {
      params.push({
        tag: encodeURIComponent(tag),
        page: String(page),
      });
    }
  }
  
  return params;
}

export default async function TagPageWithPagination({ 
  params 
}: { 
  params: Promise<{ tag: string; page: string }> 
}) {
  const resolvedParams = await params;
  const { tag, page } = resolvedParams;
  const decodedTag = decodeURIComponent(tag);
  const currentPage = parseInt(page) || 1;
  
  const allPostsForTag = getPostsByTag(decodedTag);
  const totalPosts = allPostsForTag.length;
  const totalPages = Math.ceil(totalPosts / POSTS_PER_PAGE);
  const startIndex = (currentPage - 1) * POSTS_PER_PAGE;
  const endIndex = startIndex + POSTS_PER_PAGE;
  const posts = allPostsForTag.slice(startIndex, endIndex);
  
  const allTags = getAllTags();

  return (
    <div className="bg-white pt-8 pb-24 sm:pt-12 sm:pb-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            标签: {decodedTag}
          </h1>
          <p className="mt-2 text-lg leading-8 text-gray-600">
            共 {totalPosts} 篇文章
          </p>
        </div>

        {/* Tags */}
        <div className="mx-auto mt-8 max-w-2xl">
          <div className="flex flex-wrap gap-2 justify-center">
            <Link
              href="/blog"
              className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200"
            >
              全部
            </Link>
            {allTags.map((tagName) => (
              <Link
                key={tagName}
                href={`/blog/tag/${encodeURIComponent(tagName)}/page/1`}
                className={`rounded-full px-3 py-1 text-sm font-medium ${
                  tagName === decodedTag
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tagName}
              </Link>
            ))}
          </div>
        </div>

        {/* Posts grid */}
        {posts.length > 0 ? (
          <div className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-x-8 gap-y-20 lg:mx-0 lg:max-w-none lg:grid-cols-3">
            {posts.map((post) => (
              <BlogCard key={post.slug} post={post} />
            ))}
          </div>
        ) : (
          <div className="mx-auto mt-16 max-w-2xl text-center">
            <p className="text-lg text-gray-600">
              没有找到标签为 &quot;{decodedTag}&quot; 的文章
            </p>
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
          <div className="mx-auto mt-16 max-w-2xl">
            <div className="flex items-center justify-center space-x-2">
              {/* Previous page */}
              {currentPage > 1 && (
                <Link
                  href={`/blog/tag/${encodeURIComponent(decodedTag)}/page/${currentPage - 1}`}
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
                    href={`/blog/tag/${encodeURIComponent(decodedTag)}/page/${pageNum}`}
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
                  href={`/blog/tag/${encodeURIComponent(decodedTag)}/page/${currentPage + 1}`}
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