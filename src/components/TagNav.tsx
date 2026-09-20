import Link from 'next/link';
import { getTagCounts } from '@/lib/blog';

export default function TagNav({ currentTag, allTagsActive = false }: { currentTag?: string; allTagsActive?: boolean }) {
  const tags = getTagCounts();

  return (
    <nav className="tag-nav" aria-label="文章标签">
      <div className="sidebar-section-heading">标签<span>({tags.length})</span></div>
      <div className="tag-nav-list">
        {tags.slice(0, 6).map(({ tag, count }) => (
          <Link key={tag} href={`/blog/tag/${encodeURIComponent(tag)}/page/1/`}
            aria-current={currentTag === tag ? 'page' : undefined}>
            <span>{tag}</span><span className="category-count">({count})</span>
          </Link>
        ))}
      </div>
      <Link className="tag-nav-all" href="/blog/tags/" aria-current={allTagsActive ? 'page' : undefined}>
        全部标签 <span aria-hidden="true">→</span>
      </Link>
    </nav>
  );
}
