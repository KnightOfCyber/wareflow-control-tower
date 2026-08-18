export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      {/* angular signal mark */}
      <rect x="1" y="1" width="30" height="30" rx="3" stroke="#22d3ee" strokeOpacity="0.5" strokeWidth="1.4" />
      <path d="M6 22 L12 9 L16 18 L20 11 L26 22" stroke="#22d3ee" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M6 25 H26" stroke="#ffb020" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="26" cy="22" r="1.6" fill="#ffb020" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center gap-2.5">
        <LogoMark />
        <div className="leading-none">
          <div className="text-[15px] font-bold tracking-[0.22em] text-foreground">
            WARE<span className="text-signal-cyan">FLOW</span>
          </div>
          <div className="wf-mono mt-1 text-[8px] uppercase tracking-[0.34em] text-muted-foreground">
            Ops Decision Platform
          </div>
        </div>
      </div>
    </div>
  );
}
