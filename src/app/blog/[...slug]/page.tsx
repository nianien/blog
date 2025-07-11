import { notFound } from 'next/navigation';
import { getPostBySlug, getAllPosts, getAdjacentPosts } from '@/lib/blog';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import Link from 'next/link';

export async function generateStaticParams() {
  const posts = getAllPosts();
  return posts.map((post) => ({
    slug: post.slug.split('/'),
  }));
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string[] }> }) {
  const resolvedParams = await params;
  const { slug } = resolvedParams;
  
  // 将 slug 数组连接成路径字符串
  const slugPath = slug.join('/');
  const post = getPostBySlug(slugPath);

  if (!post) {
    notFound();
  }

  const { previous, next } = getAdjacentPosts(slugPath);

  return (
    <article className="py-24 sm:py-32">
      <div className="mx-auto max-w-3xl px-6 lg:px-8">
        <div className="xl:relative">
          <div className="mx-auto max-w-2xl">
            {/* Article header */}
            <div className="text-center">
              <time
                dateTime={post.pubDate}
                className="text-gray-500"
              >
                {format(new Date(post.pubDate), 'yyyy年MM月dd日', { locale: zhCN })}
              </time>
              <h1 className="mt-6 text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
                {post.title}
              </h1>
              <p className="mt-6 text-lg leading-8 text-gray-600">
                {post.description}
              </p>
              {post.tags && post.tags.length > 0 && (
                <div className="mt-6 flex justify-center gap-2">
                  {post.tags.map((tag) => (
                    <Link
                      key={tag}
                      href={`/blog/tag/${encodeURIComponent(tag)}/page/1`}
                      className="rounded-full bg-gray-100 px-3 py-1 text-sm font-medium text-gray-700 hover:bg-gray-200"
                    >
                      {tag}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Article content */}
            <div className="mt-16 prose prose-lg prose-gray mx-auto">
              <div 
                className="prose prose-lg prose-gray mx-auto"
                dangerouslySetInnerHTML={{ 
                  __html: post.content
                    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
                    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
                    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
                    .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
                    .replace(/^##### (.*$)/gim, '<h5>$1</h5>')
                    .replace(/^###### (.*$)/gim, '<h6>$1</h6>')
                    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                    .replace(/\*(.*?)\*/g, '<em>$1</em>')
                    .replace(/`(.*?)`/g, '<code>$1</code>')
                    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '<img src="$2" alt="$1" />')
                    .replace(/\n\n/g, '</p><p>')
                    .replace(/^(.*$)/gim, '<p>$1</p>')
                    .replace(/<p><\/p>/g, '')
                    .replace(/<p>(<h[1-6]>.*<\/h[1-6]>)<\/p>/g, '$1')
                    .replace(/<p>(<strong>.*<\/strong>)<\/p>/g, '$1')
                    .replace(/<p>(<em>.*<\/em>)<\/p>/g, '$1')
                    .replace(/<p>(<code>.*<\/code>)<\/p>/g, '$1')
                    .replace(/<p>(<img[^>]*>)<\/p>/g, '$1')
                }} 
              />
            </div>

            {/* Navigation */}
            <div className="mt-16 flex items-center justify-between border-t border-gray-200 pt-8">
              <Link
                href="/blog"
                className="relative z-10 rounded-md px-4 py-2 text-sm font-semibold leading-6 text-gray-900 hover:text-blue-600 hover:bg-gray-50"
              >
                ← 返回博客列表
              </Link>
            </div>

            {/* Previous/Next Navigation */}
            {(previous || next) && (
              <div className="mt-8 grid grid-cols-1 gap-8 border-t border-gray-200 pt-8 lg:grid-cols-2">
                {previous && (
                  <div className="group">
                    <div className="flex items-center gap-x-3">
                      <div className="text-sm text-gray-500">上一篇</div>
                    </div>
                    <h3 className="mt-2 text-lg font-semibold leading-6 text-gray-900 group-hover:text-gray-600">
                      <Link href={`/blog/${previous.slug}`}>
                        <span className="absolute inset-0" />
                        {previous.title}
                      </Link>
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-gray-600 line-clamp-2">
                      {previous.description}
                    </p>
                  </div>
                )}

                {next && (
                  <div className="group">
                    <div className="flex items-center gap-x-3">
                      <div className="text-sm text-gray-500">下一篇</div>
                    </div>
                    <h3 className="mt-2 text-lg font-semibold leading-6 text-gray-900 group-hover:text-gray-600">
                      <Link href={`/blog/${next.slug}`}>
                        <span className="absolute inset-0" />
                        {next.title}
                      </Link>
                    </h3>
                    <p className="mt-3 text-sm leading-6 text-gray-600 line-clamp-2">
                      {next.description}
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
} 