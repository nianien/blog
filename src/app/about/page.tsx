export default function AboutPage() {
  return (
    <div className="bg-white py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl lg:mx-0">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            关于我
          </h1>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            你好！我是Skyfalling，一名热爱技术和写作的开发者。
          </p>
        </div>
        
        <div className="mx-auto mt-16 grid max-w-2xl grid-cols-1 gap-x-8 gap-y-16 lg:mx-0 lg:max-w-none lg:grid-cols-2">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">技术背景</h2>
            <p className="mt-6 text-base leading-7 text-gray-600">
              我是一名全栈开发者，专注于现代Web技术栈。主要技术领域包括：
            </p>
            <ul className="mt-6 list-disc list-inside text-base leading-7 text-gray-600 space-y-2">
              <li>前端开发：React, Next.js, TypeScript</li>
              <li>后端开发：Node.js, Python, Java</li>
              <li>数据库：PostgreSQL, MongoDB, Redis</li>
              <li>云服务：AWS, Docker, Kubernetes</li>
            </ul>
          </div>
          
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-gray-900">写作理念</h2>
            <p className="mt-6 text-base leading-7 text-gray-600">
              通过这个博客，我希望能够：
            </p>
            <ul className="mt-6 list-disc list-inside text-base leading-7 text-gray-600 space-y-2">
              <li>分享技术经验和学习心得</li>
              <li>记录个人成长和思考过程</li>
              <li>与志同道合的朋友交流讨论</li>
              <li>为技术社区贡献有价值的内容</li>
            </ul>
          </div>
        </div>

        <div className="mx-auto mt-16 max-w-2xl lg:mx-0">
          <h2 className="text-2xl font-bold tracking-tight text-gray-900">联系方式</h2>
          <p className="mt-6 text-base leading-7 text-gray-600">
            如果你对我的文章有任何想法或建议，欢迎通过以下方式联系我：
          </p>
          <div className="mt-6 space-y-4">
            <div className="flex items-center space-x-3">
              <span className="text-gray-500">邮箱：</span>
              <a href="mailto:contact@skyfalling.com" className="text-blue-600 hover:text-blue-500">
                contact@skyfalling.com
              </a>
            </div>
            <div className="flex items-center space-x-3">
              <span className="text-gray-500">GitHub：</span>
              <a href="https://github.com/skyfalling" className="text-blue-600 hover:text-blue-500">
                github.com/skyfalling
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 