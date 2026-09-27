import { Typography } from '@mantine/core';
import Markdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import Anchor from '@/elements/typography/Anchor.tsx';

// Modrinth descriptions mix Markdown with HTML; keep the layout attributes authors commonly use.
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [...(defaultSchema.tagNames ?? []), 'center'],
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] ?? []), 'align', 'width', 'height'],
  },
};

/** Renders a Modrinth project body (Markdown with embedded HTML), sanitized. */
export default function ModMarkdown({ content }: { content: string }) {
  return (
    <Typography>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={{
          a: ({ href, children }) => (
            <Anchor href={href} target='_blank' rel='noopener noreferrer'>
              {children}
            </Anchor>
          ),
          img: ({ src, alt, width, height }) => (
            <img
              src={typeof src === 'string' ? src : undefined}
              alt={alt ?? ''}
              width={width}
              height={height}
              loading='lazy'
              style={{ maxWidth: '100%', height: 'auto', display: 'inline-block' }}
            />
          ),
          // The panel's CSS reset strips list markers; descriptions rely on them.
          ul: ({ children }) => <ul style={{ listStyleType: 'disc', paddingLeft: '1.5rem' }}>{children}</ul>,
          ol: ({ children }) => <ol style={{ listStyleType: 'decimal', paddingLeft: '1.5rem' }}>{children}</ol>,
        }}
      >
        {content}
      </Markdown>
    </Typography>
  );
}
