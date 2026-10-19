/** First focusable element on every page (root layout). Every shell renders <main id="main" tabIndex={-1}>. */
export function SkipLink({ href = "#main", children = "Skip to main content" }: { href?: string; children?: string }) {
  return (
    <a href={href} className="al-skip" data-print-hide>
      {children}
    </a>
  );
}
