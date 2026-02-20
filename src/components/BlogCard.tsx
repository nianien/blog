import Link from 'next/link';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { BlogPost } from '@/types/blog';
import { getCategoryFromSlug } from '@/lib/blog';
import { CATEGORY_META } from '@/lib/categories';

interface BlogCardProps {
  post: BlogPost;
  currentTag?: string;
  currentCategory?: string;
}

export default function BlogCard({ post, currentTag }: BlogCardProps) {
  const encodedSlug = encodeURIComponent(post.slug);
  const articleLink = currentTag
    ? `/blog/${encodedSlug}?tag=${encodeURIComponent(currentTag)}`
    : `/blog/${encodedSlug}`;

  const categoryPath = getCategoryFromSlug(post.slug);
  const categoryMeta = CATEGORY_META[categoryPath];
  const categoryName = categoryMeta?.name || categoryPath;

  return (
    <article className="flex flex-col items-start">
      <div className="flex items-center gap-x-4 text-xs">
        <time dateTime={post.pubDate} className="text-gray-500">
          {(() => {
            try {
              if (!post.pubDate) {
                return '日期未知';
              }
              const date = new Date(post.pubDate + 'T12:00:00.000Z');
              if (isNaN(date.getTime())) {
                return post.pubDate;
              }
              return format(date, 'yyyy年MM月dd日', { locale: zhCN });
            } catch (error) {
              console.error('日期格式化错误:', error);
              return post.pubDate || '日期未知';
            }
          })()}
        </time>
        <Link
          href={`/blog/category/${categoryPath}/page/1`}
          className="relative z-10 rounded-full bg-blue-50 px-3 py-1.5 font-medium text-blue-700 hover:bg-blue-100 transition-colors"
        >
          {categoryName}
        </Link>
      </div>
      <div className="group relative">
        <h3 className="mt-3 text-lg font-semibold leading-6 text-gray-900 group-hover:text-gray-600">
          <Link href={articleLink}>
            <span className="absolute inset-0" />
            {post.title}
          </Link>
        </h3>
        <p className="mt-5 line-clamp-3 text-sm leading-6 text-gray-600">
          {post.description}
        </p>
      </div>
      {/* Tags - clickable but visually subtle */}
      {post.tags && post.tags.length > 0 && (
        <div className="relative z-10 mt-4 flex flex-wrap gap-1.5">
          {post.tags.map((tag) => (
            <Link
              key={tag}
              href={`/blog/tag/${encodeURIComponent(tag)}/page/1`}
              className="rounded-full bg-gray-50 px-2 py-0.5 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            >
              {tag}
            </Link>
          ))}
        </div>
      )}
      <div className="relative mt-6 flex items-center gap-x-4">
        <Link
          href={articleLink}
          className="text-sm font-semibold leading-6 text-gray-900 hover:text-gray-600"
        >
          阅读更多 <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>
    </article>
  );
}
