/*
 * Read · typed text, notes, and photos of notes or document pages, with an
 * optional Read along voice (CPB-Read, CPB-Read-Tab).
 */
import { useEffect, useRef, useState } from 'react';
import type { Lesson, Picture, ReadBlock, ReadContent } from '@shared/api';
import { Button, cx, EmptyState, Illustration } from '@shared/components';
import { IconArrowRight, IconPause, IconPlay, IconRead, IconSound, IconTick } from '@shared/icons';
import { navigate, paths } from '@shared/router';
import { readStored, writeStored } from '@shared/session';
import { MediaProblemNote } from '../media/MediaControls';
import { useMedia } from '../media/useMedia';
import { IconArrowLeft } from '../parts/icons';
import { finishLesson } from '../progress/progress';

export interface ReadPlayerProps {
  lesson: Lesson;
  content: ReadContent;
}

/** A page is either the typed text or one photographed / rendered page. */
export type ReadPage = { kind: 'text'; blocks: ReadBlock[] } | { kind: 'image'; picture: Picture };

/**
 * Typed text has no page breaks in the data, so it is one page; photos of
 * notes and document pages are one page each, in order.
 */
export function readPages(content: Pick<ReadContent, 'blocks' | 'pageImages'>): ReadPage[] {
  const pages: ReadPage[] = [];
  if (content.blocks.length > 0) pages.push({ kind: 'text', blocks: content.blocks });
  content.pageImages.forEach((picture) => pages.push({ kind: 'image', picture }));
  return pages;
}

function wordCount(block: ReadBlock): number {
  const text = block.kind === 'list' ? block.items.join(' ') : block.kind === 'picture' ? (block.caption ?? '') : block.text;
  // Counted by hand: String.split with a pattern would pull a 2 KB polyfill into every phone's start-up script.
  let count = 0;
  let inWord = false;
  for (let index = 0; index < text.length; index += 1) {
    const space = text.charCodeAt(index) <= 32;
    if (!space && !inWord) count += 1;
    inWord = !space;
  }
  return count;
}

/**
 * Which block the recorded voice is probably reading at `time`.
 *
 * The data has no timing for Read lessons (only the audio file), so this is
 * an estimate: each block gets a share of the recording in proportion to its
 * number of words. It can drift when the reader pauses; the learner can turn
 * the highlight off. Returns -1 when nothing can be estimated.
 */
export function blockBeingRead(blocks: readonly ReadBlock[], time: number, duration: number | null): number {
  if (duration === null || duration <= 0 || time <= 0) return -1;
  const counts = blocks.map(wordCount);
  let total = 0;
  counts.forEach((count) => {
    total += count;
  });
  if (total === 0) return -1;
  const target = Math.min(1, time / duration) * total;
  let seen = 0;
  for (let index = 0; index < counts.length; index += 1) {
    const count = counts[index] ?? 0;
    if (count === 0) continue;
    seen += count;
    if (target <= seen) return index;
  }
  return -1;
}

const SIZE_KEY = 'sensebod.read.textSize';
const SIZES = 4; // steps 0..3; 1 is the board's size (19px on 31px)

function Block({ block, reading, first }: { block: ReadBlock; reading: boolean; first: boolean }) {
  const mark = reading ? (
    <>
      <IconSound size={26} className="les-read__speaker" />
      <span className="sb-visually-hidden">Being read now: </span>
    </>
  ) : null;
  const now = reading ? 'true' : undefined;
  if (block.kind === 'heading') {
    const Tag = first ? 'h2' : 'h3';
    return (
      <Tag className={cx('les-read__heading', !first && 'les-read__heading--sub', reading && 'is-reading')} aria-current={now}>
        {mark}
        <span>{block.text}</span>
      </Tag>
    );
  }
  if (block.kind === 'paragraph') {
    return (
      <p className={cx('les-read__para', reading && 'is-reading')} aria-current={now}>
        {mark}
        <span>{block.text}</span>
      </p>
    );
  }
  if (block.kind === 'picture') {
    return (
      <figure className="les-read__figure">
        <span className="les-read__frame">
          <Illustration src={block.picture.url} alt={block.picture.alt} />
        </span>
        {block.caption ? <figcaption className="les-read__caption">{block.caption}</figcaption> : null}
      </figure>
    );
  }
  const List = block.ordered ? 'ol' : 'ul';
  return (
    <List className={cx('les-read__list', reading && 'is-reading')} aria-current={now}>
      {block.items.map((item, index) => (
        <li key={index} className="les-read__item">
          <span className={cx('les-read__bullet', !block.ordered && 'les-read__bullet--dot')} aria-hidden="true">
            {block.ordered ? index + 1 : null}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </List>
  );
}

export default function ReadPlayer({ lesson, content }: ReadPlayerProps) {
  const pages = readPages(content);
  const [pageIndex, setPageIndex] = useState(0);
  const [highlight, setHighlight] = useState(true);
  const [size, setSize] = useState(() => {
    const stored = readStored<number>(SIZE_KEY, 1);
    return typeof stored === 'number' && stored >= 0 && stored < SIZES ? Math.floor(stored) : 1;
  });
  const topRef = useRef<HTMLParagraphElement>(null);
  const turned = useRef(false);
  const media = useMedia<HTMLAudioElement>(content.audio ? [content.audio] : []);

  // After turning the page, start at its top (and tell screen readers which page it is).
  useEffect(() => {
    if (turned.current && topRef.current) topRef.current.focus();
  }, [pageIndex]);

  if (pages.length === 0) {
    return <EmptyState title="The words are not in this bag yet">Ask your facilitator.</EmptyState>;
  }

  const page = pages[Math.min(pageIndex, pages.length - 1)];
  const last = pageIndex >= pages.length - 1;
  const place = `Page ${pageIndex + 1} of ${pages.length}`;
  const playing = media.status === 'playing' || media.status === 'loading';
  const reading = highlight && content.audio && media.started && media.status !== 'ended' && page && page.kind === 'text' ? blockBeingRead(page.blocks, media.time, media.duration) : -1;

  function changeSize(step: number): void {
    const next = Math.max(0, Math.min(SIZES - 1, size + step));
    setSize(next);
    writeStored(SIZE_KEY, next);
  }

  function turn(step: number): void {
    turned.current = true;
    setPageIndex((index) => Math.max(0, Math.min(pages.length - 1, index + step)));
  }

  function finish(): void {
    finishLesson(lesson.id);
    navigate(paths.lessonDone(lesson.id));
  }

  return (
    <>
      <div className="les-read__top">
        {content.cover ? (
          <div className="les-read__cover">
            <Illustration src={content.cover.url} alt={content.cover.alt} eager />
          </div>
        ) : null}

        <section className="les-read__tools" aria-label={content.audio ? 'Read along and text size' : 'Text size'}>
          {content.audio ? (
            <>
              <p className="les-read__tools-title">
                <IconSound size={26} />
                Read along
              </p>
              {/* In the page (not `new Audio()`) so it is released with the screen. */}
              <audio ref={media.ref} preload="none" aria-label={`Reading of ${lesson.title}`} />
              {media.status === 'error' ? (
                <MediaProblemNote problem={media.problem} what="sound" onRetry={media.retry} />
              ) : (
                <button type="button" className="les-read__play" onClick={media.toggle}>
                  <span className="les-read__disc" aria-hidden="true">
                    {playing ? <IconPause size={34} /> : <IconPlay size={34} />}
                  </span>
                  <span>
                    <span className="les-read__play-word">{playing ? 'Pause the reading' : media.status === 'ended' ? 'Play the reading again' : 'Play the reading'}</span>
                    <span className="les-read__play-who">Your facilitator’s recorded voice</span>
                  </span>
                </button>
              )}
            </>
          ) : null}
          <div className="les-read__options">
            {content.audio ? (
              <Button variant="secondary" size="sm" className="les-read__highlight" icon={<IconRead size={26} />} aria-pressed={highlight} onClick={() => setHighlight((on) => !on)}>
                {highlight ? 'Highlight: on' : 'Highlight: off'}
              </Button>
            ) : null}
            <div role="group" aria-label="Text size" className="les-read__sizes">
              <span className="les-read__sizes-label">Text size</span>
              <Button variant="secondary" size="sm" className="les-read__size" aria-label="Smaller text" disabled={size === 0} onClick={() => changeSize(-1)}>
                A−
              </Button>
              <Button variant="secondary" size="sm" className="les-read__size les-read__size--big" aria-label="Bigger text" disabled={size === SIZES - 1} onClick={() => changeSize(1)}>
                A+
              </Button>
            </div>
          </div>
          {content.audio ? <p className="les-read__tools-note">The paragraph being read is marked with a blue bar and a speaker. Nothing plays by itself.</p> : null}
        </section>
      </div>

      <article className={cx('sb-card sb-card--lg sb-card--tappable les-read', `les-read--size-${size}`)} aria-label={lesson.title}>
        <div className="les-read__column">
          <p ref={topRef} tabIndex={-1} className="les-read__place">
            {place}
          </p>
          {page && page.kind === 'text'
            ? page.blocks.map((block, index) => <Block key={index} block={block} reading={index === reading} first={index === 0} />)
            : null}
          {page && page.kind === 'image' ? (
            <div className="les-read__sheet">
              <Illustration src={page.picture.url} alt={page.picture.alt || place} eager />
            </div>
          ) : null}

          <nav aria-label="Pages" className="les-read__nav">
            <p className="les-read__nav-place">
              <IconRead size={24} />
              {place}
            </p>
            {last ? (
              <Button className="les-read__nav-next" icon={<IconTick size={28} />} onClick={finish}>
                I have finished reading
              </Button>
            ) : (
              <Button className="les-read__nav-next" iconAfter={<IconArrowRight size={28} />} onClick={() => turn(1)}>
                Next page
              </Button>
            )}
            {pages.length > 1 ? (
              <Button variant="secondary" className="les-read__nav-prev" icon={<IconArrowLeft size={28} />} disabled={pageIndex === 0} onClick={() => turn(-1)}>
                Previous page
              </Button>
            ) : null}
          </nav>
        </div>
      </article>
    </>
  );
}
