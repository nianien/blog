import Link from 'next/link';
import { notFound } from 'next/navigation';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { getPostWithNavigation } from '@/lib/blog';
import SyntaxHighlightedContent from '@/components/SyntaxHighlightedContent';
import BlogPostNavigation from '@/components/BlogPostNavigation';
import { Suspense } from 'react';

export async function generateStaticParams() {
  const { getAllPosts } = await import('@/lib/blog');
  const posts = getAllPosts();
  const params = [];
  
  // 为每个文章生成参数
  for (const post of posts) {
    // 直接使用中文路径
    params.push({
      slug: post.slug.split('/'),
    });
  }
  
  return params;
}

export default async function BlogPostPage({ 
  params
}: { 
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  const slugString = slug.join('/');
  
  const postData = getPostWithNavigation(slugString);
  if (!postData) {
    notFound();
  }

  const { post, globalNav, tagNav } = postData;

  return (
    <article className="min-h-screen">
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="rounded-2xl shadow-2xl border border-gray-200 hover:shadow-3xl transition-all duration-300 p-8 sm:p-12">
          {/* 文章头部信息 */}
          <header className="mb-8">
            <div className="flex items-center mb-6">
              <div className="inline-flex items-center px-3 py-1.5 bg-gray-50 text-gray-600 rounded-md text-sm font-normal">
                <svg className="w-4 h-4 mr-2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <time dateTime={post.pubDate}>
                  {format(new Date(post.pubDate), 'yyyy年MM月dd日', { locale: zhCN })}
                </time>
              </div>
            </div>
            
            <h1 className="text-4xl font-bold text-gray-900 mb-6 text-center">
              {post.title}
            </h1>
            
            {post.tags && post.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-6 justify-center">
                {post.tags.map((tag) => (
                  <Link
                    key={tag}
                    href={`/blog/tag/${encodeURIComponent(tag)}/page/1/`}
                    className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-gray-200 text-gray-800 hover:bg-gray-300 hover:text-gray-900 transition-colors"
                  >
                    {tag}
                  </Link>
                ))}
              </div>
            )}
          </header>

          {/* 文章内容 */}
          <div className="max-w-5xl mx-auto">
            <SyntaxHighlightedContent content={post.content} />
          </div>

          {/* 文章导航 */}
          <Suspense fallback={<div className="mt-12 pt-8 border-t border-gray-200">加载导航中...</div>}>
            <BlogPostNavigation 
              globalNav={globalNav}
              tagNav={tagNav}
            />
          </Suspense>
        </div>
      </div>
    </article>
  );
} 