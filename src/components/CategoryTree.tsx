'use client';

import { useState } from 'react';
import Link from 'next/link';

interface CategoryGroup {
  key: string;
  name: string;
  count: number;
  children: { path: string; name: string; count: number }[];
}

export default function CategoryTree({ groups, totalCount, currentCategory, allActive }: {
  groups: CategoryGroup[];
  totalCount: number;
  currentCategory?: string;
  allActive: boolean;
}) {
  const activeMain = currentCategory?.split('/')[0] || null;
  const [expandedMain, setExpandedMain] = useState<string | null>(activeMain);

  return (
    <nav className="category-nav" aria-label="文章分类">
      <Link href="/blog/page/1/" aria-current={allActive ? 'page' : undefined}>
        <span>全部</span><span className="category-count">({totalCount})</span>
      </Link>
      {groups.map(group => {
        const expanded = expandedMain === group.key;
        return (
          <div className="category-group" key={group.key}>
            <div className="category-parent-row">
              <Link href={`/blog/category/${group.key}/page/1`}
                className={activeMain === group.key ? 'category-parent-active' : undefined}
                aria-current={currentCategory === group.key ? 'page' : undefined}
                onClick={() => setExpandedMain(group.key)}>
                <span>{group.name}</span><span className="category-count">({group.count})</span>
              </Link>
              {group.children.length > 0 && (
                <button type="button" className="category-toggle"
                  aria-expanded={expanded} aria-controls={`category-children-${group.key}`}
                  aria-label={`${expanded ? '收起' : '展开'}${group.name}的二级分类`}
                  onClick={() => setExpandedMain(expanded ? null : group.key)} />
              )}
            </div>
            {group.children.length > 0 && (
              <div className="category-sub" id={`category-children-${group.key}`} hidden={!expanded}>
                {group.children.map(category => (
                  <Link key={category.path} href={`/blog/category/${category.path}/page/1`}
                    aria-current={currentCategory === category.path ? 'page' : undefined}>
                    <span>{category.name}</span><span className="category-count">({category.count})</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
