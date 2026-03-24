import Link from 'next/link';
import { getAllPosts } from '@/lib/blog';
import BlogCard from '@/components/BlogCard';

export default function Home() {
  const allPosts = getAllPosts();

  const gridPosts = allPosts.slice(0, 9);

  return (
    <div className="bg-[var(--background)]">
      {/* Hero title */}
      <div className="mx-auto max-w-7xl px-6 pt-8 sm:pt-12 lg:px-8">
        <h1 className="text-center text-2xl font-bold tracking-tight text-gray-900 sm:text-3xl mb-10">
          Think ahead, see beyond
        </h1>
      </div>

      {/* Latest posts */}
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <h2 className="text-2xl font-bold tracking-tight text-gray-900">
          最新文章
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
