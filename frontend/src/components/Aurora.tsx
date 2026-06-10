// Fixed background layer: drifting aurora blobs + film grain + perspective grid.
// Pure CSS animations (transform-only) so it costs almost nothing.
export function Aurora() {
  return (
    <>
      <div className="aurora" aria-hidden>
        <div className="blob b1" />
        <div className="blob b2" />
        <div className="blob b3" />
        <div className="blob b4" />
      </div>
      <div className="gridfloor" aria-hidden />
      <div className="grain" aria-hidden />
    </>
  );
}
