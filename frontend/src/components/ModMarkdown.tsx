import { Typography } from '@mantine/core';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import Anchor from '@/elements/typography/Anchor.tsx';
import { safeLink } from '../lib/files.ts';

// Descriptions mix Markdown with HTML; keep the layout attributes authors commonly use.
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'center'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'align', 'width', 'height'],
  },
};

/**
 * Renders a project description, sanitized: Modrinth Markdown (with embedded HTML) or CurseForge HTML.
 * Only http(s) links are kept, and images load without sending a referrer.
 */
export default function ModMarkdown({
  content,
  format = 'markdown',
}: {
  content: string;
  format?: 'markdown' | 'html';
}) {
  // Indentation in HTML would otherwise turn nested tags into Markdown code blocks.
  const source = format === 'html' ? content.replace(/^[ \t]+/gm, '') : content;

  return (
    <Typography>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={{
          a: ({ href, children }) => {
            const link = safeLink(href);
            return link ? (
              <Anchor href={link} target='_blank' rel='noopener noreferrer'>
                {children}
              </Anchor>
            ) : (
              <span>{children}</span>
            );
          },
          img: ({ src, alt, width, height }) => {
            const link = typeof src === 'string' ? safeLink(src) : null;
            return link ? (
              <img
                src={link}
                alt={alt ?? ''}
                width={width}
                height={height}
                loading='lazy'
                referrerPolicy='no-referrer'
                style={{ maxWidth: '100%', height: 'auto', display: 'inline-block' }}
              />
            ) : null;
          },
          // The panel's CSS reset strips list markers; descriptions rely on them.
          ul: ({ children }) => <ul style={{ listStyleType: 'disc', paddingLeft: '1.5rem' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ listStyleType: 'decimal', paddingLeft: '1.5rem' }}>{children}</ol>,
        }}
      >
        {source}
      </Markdown>
    </Typography>
  );
}
