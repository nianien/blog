'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { NavigationInfo } from '@/types/blog';

interface BlogPostNavigationProps {
  globalNav: NavigationInfo;
  tagNav: Record<string, NavigationInfo>;
}

export default function BlogPostNavigation({ globalNav, tagNav }: BlogPostNavigationProps) {
  const tagContext = useSearchParams().get('tag');
  const validTag = tagContext && tagNav[tagContext] ? tagContext : null;
  const nav = validTag ? tagNav[validTag] : globalNav;
  if (!nav.prev && !nav.next) return null;
  return (
    <nav className="post-navigation" aria-label={validTag ? `${validTag} 标签内文章` : '按发布时间浏览文章'}>
      {(['prev', 'next'] as const).map(direction => {
        const post = nav[direction];
        return post ? <Link key={direction} className={`post-navigation-${direction}`}
          href={`/blog/${encodeURIComponent(post.slug)}${validTag ? `?tag=${encodeURIComponent(validTag)}` : ''}`}>
          <span>{direction === 'prev' ? '上一篇' : '下一篇'}</span><strong>{post.title}</strong>
        </Link> : null;
      })}
    </nav>
  );
}
