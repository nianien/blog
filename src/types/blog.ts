export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  pubDate: string;
  tags?: string[];
  heroImage?: string;
  content: string;
}

export interface BlogMeta {
  title: string;
  description: string;
  pubDate: string;
  tags?: string[];
  heroImage?: string;
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