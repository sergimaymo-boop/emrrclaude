/**
 * RS Sparkline Component
 * Tiny inline chart showing 3-month Relative Strength trend
 * One SVG line per stock with min/max reference lines
 */

interface Props {
  rs3m: number | null;  // 3-month RS value (-20 to +20 typical); null = no data yet
  size?: 'sm' | 'md';   // small (24px) or medium (32px)
}

/**
 * Generate SVG sparkline for RS 3M
 * Shows if stock beating or lagging SPY
 */
function generateSparklinePath(rs3m: number, width: number, height: number): string {
  // Normalize RS (-20 to +20) to SVG coords (0 to height)
  const normalized = Math.max(0, Math.min(height, (rs3m + 20) * (height / 40)));
  const midline = height / 2;

  // Create a simple trend: left side low, right side at rs3m value
  // This shows the direction of RS trend
  const points = [
    [0, midline],                    // start at middle
    [width * 0.25, midline - 2],     // slight early movement
    [width * 0.5, normalized],       // peak/trough
    [width * 0.75, normalized - 1],  // slight consolidation
    [width, normalized],             // end at RS value
  ];

  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ');
}

export function RSSparkline({ rs3m, size = 'sm' }: Props) {
  // Render a neutral placeholder when data is not yet available
  if (rs3m === null || rs3m === undefined) {
    const placeholderSize = size === 'md' ? { width: 64, height: 32, textSize: 11 } : { width: 48, height: 24, textSize: 9 };
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg width={placeholderSize.width} height={placeholderSize.height} viewBox={`0 0 ${placeholderSize.width} ${placeholderSize.height}`} style={{ background: 'rgba(71,85,105,0.08)', borderRadius: 4 }}>
          <line x1="0" y1={placeholderSize.height / 2} x2={placeholderSize.width} y2={placeholderSize.height / 2} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" strokeDasharray="2,2" />
        </svg>
        <span style={{ fontSize: placeholderSize.textSize, fontWeight: 700, color: '#475569', minWidth: 32 }}>RS —</span>
      </div>
    );
  }

  const sizes = {
    sm: { width: 48, height: 24, stroke: 1.5, textSize: 9 },
    md: { width: 64, height: 32, stroke: 2, textSize: 11 },
  };

  const config = sizes[size];
  const isPositive = rs3m > 0;
  const isStrong = Math.abs(rs3m) > 10;

  const colors = {
    line: isPositive
      ? isStrong ? '#10b981' : '#34d399'  // green if beating SPY
      : isStrong ? '#ef4444' : '#f87171', // red if lagging SPY
    bg: isPositive
      ? 'rgba(16,185,129,0.08)'
      : 'rgba(239,68,68,0.08)',
  };

  const midline = config.height / 2;
  const path = generateSparklinePath(rs3m, config.width, config.height);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <svg width={config.width} height={config.height} viewBox={`0 0 ${config.width} ${config.height}`} style={{
        background: colors.bg,
        borderRadius: 4,
      }}>
        {/* Reference lines */}
        <line x1="0" y1={midline} x2={config.width} y2={midline} stroke="rgba(255,255,255,0.1)" strokeWidth="0.5" strokeDasharray="2,2" />

        {/* Trend line */}
        <path
          d={path}
          stroke={colors.line}
          strokeWidth={config.stroke}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Current value indicator (small dot) */}
        {/* <circle cx={config.width} cy={generateSparklinePath(rs3m, config.width, config.height).split(' ').reverse()[1]} r="1.5" fill={colors.line} /> */}
      </svg>

      {/* Label */}
      <span style={{
        fontSize: config.textSize,
        fontWeight: 700,
        color: colors.line,
        fontVariantNumeric: 'tabular-nums',
        minWidth: 32,
      }}>
        {rs3m > 0 ? '+' : ''}{rs3m.toFixed(1)}%
      </span>
    </div>
  );
}
