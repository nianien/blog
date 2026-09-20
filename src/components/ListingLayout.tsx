import type { ReactNode } from 'react';
import type { BrowseView } from '@/lib/article-browse';
import BrowseNav from '@/components/BrowseNav';
import CategoryNav from '@/components/CategoryNav';
import TagNav from '@/components/TagNav';

interface ListingLayoutProps {
  header: ReactNode;
  children: ReactNode;
  currentCategory?: string;
  currentTag?: string;
  currentView?: BrowseView;
  allTagsActive?: boolean;
}

export default function ListingLayout({ header, children, currentCategory, currentTag, currentView, allTagsActive = false }: ListingLayoutProps) {
  return (
    <div className="listing-layout page-space">
      <div className="listing-header">{header}</div>
      <aside className="listing-sidebar listing-sidebar-left">
        <BrowseNav currentView={currentView} />
        <div className="category-section">
          <div className="sidebar-section-heading">分类</div>
          <CategoryNav currentCategory={currentCategory} allActive={currentView === 'all'} />
        </div>
      </aside>
      <div className="listing-content">{children}</div>
      <aside className="listing-sidebar listing-sidebar-right">
        <TagNav currentTag={currentTag} allTagsActive={allTagsActive} />
      </aside>
    </div>
  );
}
