'use client';

import Giscus from '@giscus/react';

export default function GiscusComments() {
  return (
    <div className="mt-16 border-t border-gray-200 pt-8">
      <div className="mx-auto max-w-3xl">
        <h3 className="text-2xl font-bold text-gray-900 mb-8">评论</h3>
        <Giscus
          id="comments"
          repo="nianien/blog"
          repoId="R_kgDOJzwbWg"
          category="General"
          categoryId="DIC_kwDOJzwbWs4Cs5IG"
          mapping="pathname"
          strict="0"
          reactionsEnabled="1"
          emitMetadata="0"
          inputPosition="bottom"
          theme="preferred_color_scheme"
          lang="zh-CN"
          loading="lazy"
        />
      </div>
    </div>
  );
} 