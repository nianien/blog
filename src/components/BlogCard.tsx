import Link from 'next/link';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { BlogPost } from '@/types/blog';

interface BlogCardProps {
  post: BlogPost;
  currentTag?: string;
}

export default function BlogCard({ post, currentTag }: BlogCardProps) {
  // 构建文章链接，如果提供了currentTag，则包含标签参数
  // 对slug进行URL编码以处理空格和特殊字符
  const encodedSlug = encodeURIComponent(post.slug);
  const articleLink = currentTag 
    ? `/blog/${encodedSlug}?tag=${encodeURIComponent(currentTag)}`
    : `/blog/${encodedSlug}`;

  return (
    <article className="flex flex-col items-start">
      <div className="flex items-center gap-x-4 text-xs">
        <time dateTime={post.pubDate} className="text-gray-500">
          {(() => {
            try {
              // 检查日期是否存在
              if (!post.pubDate) {
                return '日期未知';
              }
              
              // 确保使用 ISO 日期格式，避免时区问题
              const date = new Date(post.pubDate + 'T12:00:00.000Z');
              
              // 检查日期是否有效
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
        <div className="flex gap-2">
          {post.tags?.map((tag) => (
            <span
              key={tag}
              className="relative z-10 rounded-full bg-gray-50 px-3 py-1.5 font-medium text-gray-600 hover:bg-gray-100"
            >
              {tag}
            </span>
          ))}
        </div>
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
      <div className="relative mt-8 flex items-center gap-x-4">
        <Link
          href={articleLink}
          className="text-sm font-semibold leading-6 text-gray-900 hover:text-gray-600"
        >
          阅读更多 <span aria-hidden="true">→</span>
        </Link>
      </div>
    </article>
  );
} 