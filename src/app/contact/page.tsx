export default function ContactPage() {
  return (
    <div className="bg-[var(--background)] py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">
            联系我
          </h1>
          <p className="mt-6 text-lg leading-8 text-gray-600">
            如果你有任何问题、建议或合作意向，欢迎随时联系我。
          </p>
        </div>

        <div className="mx-auto mt-16 max-w-2xl">
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
            <div className="rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900">邮箱联系</h3>
              <p className="mt-2 text-sm text-gray-600">
                发送邮件到以下地址，我会尽快回复你。
              </p>
              <a
                href="mailto:nianien@gmail.com"
                className="mt-4 inline-flex items-center text-blue-600 hover:text-blue-500"
              >
                nianien@gmail.com
              </a>
            </div>

            <div className="rounded-lg p-6">
              <h3 className="text-lg font-semibold text-gray-900">GitHub</h3>
              <p className="mt-2 text-sm text-gray-600">
                关注我的GitHub，查看开源项目和代码。
              </p>
              <a
                href="https://github.com/nianien"
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-flex items-center text-blue-600 hover:text-blue-500"
              >
                github.com/nianien
              </a>
            </div>
          </div>

          <div className="mt-8 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900">关于合作</h3>
            <p className="mt-2 text-sm text-gray-600">
              如果你有技术合作、项目咨询或内容创作的需求，我很乐意与你交流。请通过邮箱联系我，我会详细回复你的需求。
            </p>
          </div>

          <div className="mt-8 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-900">反馈建议</h3>
            <p className="mt-2 text-sm text-gray-600">
              如果你对博客内容有任何建议或发现任何问题，欢迎随时反馈。你的意见对我来说非常宝贵。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
} 