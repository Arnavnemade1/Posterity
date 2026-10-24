/**
 * Structured data for search engines. It is JSON inside a script tag, so a `<` in a title or a post body must never
 * reach the page unescaped (it could close the tag): they are written as <.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
