import { useEffect, useRef, useState } from 'react';
import { resolvePictureUrl } from '../illustrations/illustrationUrl';
import type { Picture as PictureData } from '../api/types';
import { cx } from './cx';

const nativeLazy = typeof HTMLImageElement !== 'undefined' && 'loading' in HTMLImageElement.prototype;

export interface IllustrationProps {
  /**
   * Either an illustration key ("child-protection/scenes/CPB-Child-lesson1",
   * no extension), or a root-relative URL from the API ("/illustrations/…",
   * "/media/…").
   */
  src: string;
  /** Describes the scene. Pass "" when the picture is decoration next to the same words. */
  alt: string;
  /** Load at once. Use only for the one picture at the top of a screen. Default: lazy. */
  eager?: boolean;
  width?: number;
  height?: number;
  className?: string;
}

/**
 * A cast or scene drawing, loaded as a separate cached file by URL: never
 * inlined into JavaScript. Off-screen pictures wait until they are near the
 * viewport: natively where `loading="lazy"` exists (Chrome 77+), with an
 * IntersectionObserver on older browsers (Chrome 51+), and eagerly as the
 * last resort.
 */
export function Illustration({ src, alt, eager = false, width, height, className }: IllustrationProps) {
  const url = resolvePictureUrl(src);
  const ref = useRef<HTMLSpanElement>(null);
  const observe = !eager && !nativeLazy && typeof IntersectionObserver !== 'undefined';
  const [visible, setVisible] = useState(!observe);
  // The address that failed to load, so a new picture gets a new chance.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!observe || visible) return undefined;
    const node = ref.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '300px 0px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [observe, visible]);

  if (!visible) {
    // Old browsers without native lazy loading: hold the place with an empty
    // box (no request, no data: URI) until it scrolls near the screen.
    // A named placeholder is an image to a screen reader; a decorative one is hidden from it.
    const naming = alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true };
    return <span ref={ref} className={cx('sb-illustration', className)} style={{ display: 'block', width, height }} {...naming} />;
  }
  // A picture that did not load is taken out, so the card keeps its plain
  // tint instead of the browser's broken-image mark. Its words stay for
  // screen readers.
  if (failedUrl === url) return alt ? <span className="sb-visually-hidden">{alt}</span> : null;
  return (
    <img
      className={cx('sb-illustration', className)}
      src={url}
      alt={alt}
      width={width}
      height={height}
      loading={eager ? undefined : 'lazy'}
      decoding="async"
      draggable={false}
      onError={() => setFailedUrl(url)}
    />
  );
}

export type PictureShape = 'lesson' | 'portal' | 'topic' | 'header' | 'square';

export interface ScenePictureProps {
  /** From the API. null draws the tint only, so every card keeps the same height. */
  picture: PictureData | null;
  /** lesson 360x200 (default), portal 358x150, topic 284x100, header 390x220, square. */
  shape?: PictureShape;
  eager?: boolean;
  className?: string;
}

/** The picture area at the top of a card: fixed shape on a light tint, picture cropped to fill. */
export function ScenePicture({ picture, shape = 'lesson', eager, className }: ScenePictureProps) {
  return (
    <span className={cx('sb-picture', shape !== 'lesson' && `sb-picture--${shape}`, className)}>
      {picture ? <Illustration className="sb-picture__img" src={picture.url} alt={picture.alt} eager={eager} /> : null}
    </span>
  );
}
