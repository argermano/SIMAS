'use client'

import ReactMarkdown from 'react-markdown'

interface MarkdownPreviewProps {
  children: string
  className?: string
}

export function MarkdownPreview({ children, className }: MarkdownPreviewProps) {
  return (
    <div className={className}>
    <ReactMarkdown
      components={{
        h1: ({ children }) => (
          <h1 className="text-base font-bold text-center uppercase mt-4 mb-3 text-gray-900">
            {children}
          </h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-sm font-bold uppercase mt-5 mb-2 text-gray-900">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-semibold mt-3 mb-1 text-gray-900">
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="text-sm leading-relaxed mb-2 text-gray-800 text-justify">
            {children}
          </p>
        ),
        hr: () => <hr className="my-3 border-gray-300" />,
        strong: ({ children }) => (
          <strong className="font-semibold text-gray-900">{children}</strong>
        ),
        ul: ({ children }) => (
          <ul className="ml-4 mb-2 space-y-1 list-none">{children}</ul>
        ),
        li: ({ children }) => (
          <li className="text-sm leading-relaxed text-gray-800">• {children}</li>
        ),
        blockquote: ({ children }) => (
          <blockquote className="ml-4 border-l-2 border-gray-300 pl-3 text-sm text-gray-600 my-2">
            {children}
          </blockquote>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
    </div>
  )
}
