import Link from 'next/link';
import type { Metadata } from 'next';
import { getTagCounts } from '@/lib/blog';
import ListingLayout from '@/components/ListingLayout';

export const metadata: Metadata = {
  title: '全部标签',
  description: '按关联文章数量浏览全部文章标签',
  alternates: { canonical: '/blog/tags/' },
};

export default function TagsPage() {
  const tags = getTagCounts();

  return (
    <ListingLayout allTagsActive header={
      <header className="listing-heading"><h1 className="page-title">全部标签</h1><span>({tags.length})</span></header>
    }>
      <ul className="tag-index-list">
        {tags.map(({ tag, count }) => (
          <li key={tag}>
            <Link href={`/blog/tag/${encodeURIComponent(tag)}/page/1/`}>
              <span>{tag}</span><span className="category-count">({count})</span>
            </Link>
          </li>
        ))}
      </ul>
    </ListingLayout>
  );
}
