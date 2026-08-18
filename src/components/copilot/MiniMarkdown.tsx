import React from "react";

/**
 * MiniMarkdown — renders the small markdown subset the Copilot emits:
 * **bold**, `inline code`, `- ` bullets and numbered lists. Kept dependency
 * free on purpose (no react-markdown in this project).
 */

function renderInline(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <code key={i} className="wf-mono rounded-[2px] bg-muted/70 px-1 py-px text-[0.92em] text-signal-cyan">
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
}

export function MiniMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  let numbered = 0;
  return (
    <div className="space-y-1.5">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;

        const bullet = trimmed.match(/^[-•]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
              <span className="shrink-0 text-signal-cyan">▸</span>
              <span className="min-w-0">{renderInline(bullet[1])}</span>
            </div>
          );
        }

        const numberedMatch = trimmed.match(/^(\d+)[.)]\s+(.*)$/);
        if (numberedMatch) {
          numbered += 1;
          return (
            <div key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
              <span className="wf-mono shrink-0 text-signal-amber">{numberedMatch[1]}.</span>
              <span className="min-w-0">{renderInline(numberedMatch[2])}</span>
            </div>
          );
        }

        return (
          <p key={i} className="text-xs leading-relaxed text-muted-foreground">
            {renderInline(trimmed)}
          </p>
        );
      })}
    </div>
  );
}
