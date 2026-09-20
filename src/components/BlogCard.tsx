import Link from 'next/link';
import { format } from 'date-fns';
import { BlogPost } from '@/types/blog';
import { getCategoryFromSlug } from '@/lib/blog';
import { CATEGORY_META } from '@/lib/categories';

interface BlogCardProps {
  post: BlogPost;
  currentTag?: string;
}

export default function BlogCard({ post, currentTag }: BlogCardProps) {
  const articleLink = `/blog/${encodeURIComponent(post.slug)}${currentTag ? `?tag=${encodeURIComponent(currentTag)}` : ''}`;
  const categoryPath = getCategoryFromSlug(post.slug);
  const date = new Date(post.pubDate + 'T12:00:00.000Z');
  const dateLabel = !post.pubDate ? '日期未知' : Number.isNaN(date.getTime())
    ? post.pubDate : format(date, 'yyyy.MM.dd');

  return (
    <article className="post-entry">
      <h2 className="post-entry-title"><Link href={articleLink}>{post.title}</Link></h2>
      {post.description && <p className="post-entry-summary">{post.description}</p>}
      <div className="post-entry-meta">
        <Link href={`/blog/category/${categoryPath}/page/1`}>
          {CATEGORY_META[categoryPath]?.name || categoryPath}
        </Link>
        <time dateTime={post.pubDate}>{dateLabel}</time>
      </div>
    </article>
  );
}
