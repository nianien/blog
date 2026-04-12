export interface SeriesInfo {
  key: string;
  order?: number;
}

export interface SeriesMeta {
  name: string;
  description?: string;
}

export interface SeriesNavItem {
  slug: string;
  title: string;
  order?: number;
  isCurrent: boolean;
}

export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  pubDate: string;
  tags?: string[];
  heroImage?: string;
  series?: SeriesInfo;
  content: string;
}

export interface BlogMeta {
  title: string;
  description: string;
  pubDate: string;
  tags?: string[];
  heroImage?: string;
  series?: SeriesInfo;
}

export interface NavigationInfo {
  prev: BlogPost | null;
  next: BlogPost | null;
}

export interface BlogPostWithNavigation {
  post: BlogPost;
  globalNav: NavigationInfo;
  tagNav: Record<string, NavigationInfo>;
}

export interface Category {
  path: string;       // "engineering/agentic"
  main: string;       // "engineering"
  sub: string;        // "agentic"
  name: string;       // "Agentic 系统"
  mainName: string;   // "技术工程"
  count: number;
}