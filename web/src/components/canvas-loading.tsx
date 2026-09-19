const cards = [
  { className: "skeleton-card-one", rows: 4 },
  { className: "skeleton-card-two", rows: 3 },
  { className: "skeleton-card-three", rows: 5 },
];

export function CanvasLoading() {
  return (
    <div className="canvas-loading" role="status" aria-label="Loading schema graph">
      <svg className="skeleton-links" viewBox="0 0 800 520" aria-hidden="true">
        <path d="M265 142 C360 142 350 272 448 272" />
        <path d="M274 410 C355 410 352 292 448 292" />
      </svg>
      {cards.map((card) => (
        <div
          key={card.className}
          className={`skeleton-table ${card.className}`}
        >
          <div className="skeleton-table-header"><i /><span /></div>
          {Array.from({ length: card.rows }, (_, row) => (
            <div className="skeleton-table-row" key={row}><i /><span /><b /></div>
          ))}
          <div className="skeleton-shimmer" aria-hidden="true" />
        </div>
      ))}
      <span className="canvas-loading-label">Mapping schema relationships…</span>
    </div>
  );
}