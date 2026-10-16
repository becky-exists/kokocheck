import { useEffect, useState, type CSSProperties } from 'react';

// Follow the area above the software keyboard. Leave pinch zoom to the browser.
export function useVisibleViewport(active: boolean) {
  const [viewport, setViewport] = useState({ height: window.innerHeight, top: 0 });
  useEffect(() => {
    if (!active) return;
    const visual = window.visualViewport;
    const update = () => {
      if (visual && Math.abs(visual.scale - 1) > .05) return;
      setViewport({ height: visual?.height ?? window.innerHeight, top: visual?.offsetTop ?? 0 });
    };
    update();
    visual?.addEventListener('resize', update);
    visual?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      visual?.removeEventListener('resize', update);
      visual?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [active]);
  return {
    style: { '--visible-height': `${viewport.height}px`, '--visible-top': `${viewport.top}px` } as CSSProperties,
    compact: viewport.height < 560,
  };
}
