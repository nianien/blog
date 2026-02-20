import Link from 'next/link';
import { getAllPosts, getFeaturedPosts } from '@/lib/blog';
import BlogCard from '@/components/BlogCard';

export default function Home() {
  const featuredPosts = getFeaturedPosts();
  const hasFeatured = featuredPosts.length > 0;

  const featuredSlugs = new Set(featuredPosts.map(p => p.slug));
  const allLatest = getAllPosts().filter(p => !featuredSlugs.has(p.slug));

  const heroPost = !hasFeatured ? allLatest[0] : null;
  const gridPosts = hasFeatured
    ? allLatest.slice(0, 6)
    : allLatest.slice(1, 9);

  return (
    <div className="bg-[var(--background)]">
      {/* Hero title */}
      <div className="mx-auto max-w-7xl px-6 pt-8 sm:pt-12 lg:px-8">
        <h1 className="text-center text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl mb-10">
          Think ahead, see beyond
        </h1>
      </div>

      {/* Featured posts (only when configured) */}
      {hasFeatured && (
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="rounded-2xl bg-gray-50 px-8 py-10">
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">精选文章</h2>
            <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-12 lg:grid-cols-3">
              {featuredPosts.map((post) => (
                <BlogCard key={post.slug} post={post} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Hero card (time-flow fallback) */}
      {heroPost && (
        <div className="mx-auto max-w-7xl px-6 lg:px-8">
          <div className="mx-auto max-w-3xl">
            <BlogCard post={heroPost} />
          </div>
        </div>
      )}

      {/* Latest posts */}
      <div className="mx-auto mt-20 max-w-7xl px-6 lg:px-8">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          {hasFeatured ? '最新发布' : '更多文章'}
        </h2>
        <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-12 lg:grid-cols-3">
          {gridPosts.map((post) => (
            <BlogCard key={post.slug} post={post} />
          ))}
        </div>
        <div className="mt-12 mb-16 flex justify-center">
          <Link
            href="/blog"
            className="rounded-md bg-white px-3.5 py-2.5 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50"
          >
            查看全部文章 &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
