/*
 * Picture lesson (CLB-Climate-Lesson): a few pictures with short captions
 * that show what to do, step by step. In the data these are Read lessons
 * made only of picture blocks (API-CONTRACT section 8).
 */
import { useEffect, useState } from 'react';
import type { Lesson, Picture, ReadBlock, ReadContent } from '@shared/api';
import { Badge, Button, ButtonLink, cx, Illustration, ScenePicture } from '@shared/components';
import { IconInfo, IconPlay, IconTick } from '@shared/icons';
import { navigate, paths } from '@shared/router';
import { ListenBar } from '@shared/shell';
import { IconArrowLeft, IconPictures } from '../parts/icons';
import { seriesPath, TITLE_ID } from '../parts/LessonParts';
import { finishLesson } from '../progress/progress';

export interface Frame {
  picture: Picture;
  caption: string | null;
}

/** The frames of a picture lesson, or null when the lesson is ordinary reading. */
export function pictureFrames(content: Pick<ReadContent, 'blocks' | 'pageImages'>): Frame[] | null {
  if (content.blocks.length === 0 || content.pageImages.length > 0) return null;
  const frames: Frame[] = [];
  for (const block of content.blocks as readonly ReadBlock[]) {
    if (block.kind !== 'picture') return null;
    frames.push({ picture: block.picture, caption: block.caption });
  }
  return frames;
}

/** How long each picture stays while "Play animation" runs. Slow on purpose. */
const FRAME_MS = 3500;

export default function PictureLesson({ lesson, frames, cover }: { lesson: Lesson; frames: Frame[]; cover: Picture | null }) {
  /** The picture showing while the animation plays, or -1 when it is not playing. */
  const [showing, setShowing] = useState(-1);

  // One timer per picture, cleared when the picture changes or the screen goes.
  useEffect(() => {
    if (showing === -1) return undefined;
    const timer = window.setTimeout(() => setShowing(showing + 1 < frames.length ? showing + 1 : -1), FRAME_MS);
    return () => window.clearTimeout(timer);
  }, [showing, frames.length]);

  function finish(): void {
    finishLesson(lesson.id);
    navigate(paths.lessonDone(lesson.id));
  }

  const count = Math.max(lesson.series.lessonCount, lesson.position ?? 1);
  const current = showing === -1 ? undefined : frames[showing];

  return (
    <div className="les-picture">
      <p className="les-picture__place">
        {lesson.group.title}
        {lesson.position !== null ? ` · Lesson ${lesson.position} of ${count}` : ''}
      </p>

      <section className="sb-card sb-card--lg sb-card--tappable les-picture__hero" aria-labelledby={TITLE_ID}>
        <ScenePicture picture={cover ?? lesson.picture} shape="header" eager />
        <div className="les-picture__body">
          <Badge size="lg" overlap>
            <IconPictures size={40} />
          </Badge>
          <h1 id={TITLE_ID} className="les-picture__title">
            {lesson.title}
          </h1>
          {lesson.summary ? <p className="les-picture__summary">{lesson.summary}</p> : null}
          <ListenBar src={lesson.listenUrl} className="les-header__listen" />
        </div>
      </section>

      <section className="sb-card sb-card--lg sb-card--tappable les-picture__steps" aria-labelledby="les-picture-steps">
        <h2 id="les-picture-steps" className="les-picture__heading">
          Watch it step by step
        </h2>
        <p className="les-picture__lead">{frames.length === 1 ? 'One picture shows what to do.' : `${frames.length} pictures show what to do.`}</p>

        {current ? (
          <div className="les-picture__frame les-picture__frame--playing" role="status">
            <Illustration key={showing} className="les-picture__img" src={current.picture.url} alt={current.picture.alt} eager />
            <p className="les-picture__caption">
              <span className="les-picture__number" aria-hidden="true">
                {showing + 1}
              </span>
              <span className="sb-visually-hidden">
                Picture {showing + 1} of {frames.length}:{' '}
              </span>
              {current.caption}
            </p>
          </div>
        ) : (
          <ol className="les-picture__list">
            {frames.map((frame, index) => (
              <li key={index} className="les-picture__frame">
                <Illustration className="les-picture__img" src={frame.picture.url} alt={frame.picture.alt} />
                <p className="les-picture__caption">
                  <span className="les-picture__number" aria-hidden="true">
                    {index + 1}
                  </span>
                  {frame.caption}
                </p>
              </li>
            ))}
          </ol>
        )}

        {frames.length > 1 ? (
          <>
            <Button variant="secondary" fullWidth className={cx('les-picture__play')} icon={<IconPlay size={30} />} aria-pressed={showing !== -1} onClick={() => setShowing(showing === -1 ? 0 : -1)}>
              {showing === -1 ? 'Play animation' : 'Stop'}
            </Button>
            <p className="les-note">
              <IconInfo size={28} />
              <span>The pictures change slowly, one at a time. If your phone is set to reduce motion, they change with no movement. It never plays by itself.</span>
            </p>
          </>
        ) : null}
      </section>

      <div className="les-picture__nav">
        <ButtonLink to={seriesPath(lesson)} variant="secondary" icon={<IconArrowLeft size={30} />}>
          Back
        </ButtonLink>
        <Button icon={<IconTick size={30} />} onClick={finish}>
          I have finished
        </Button>
      </div>
    </div>
  );
}
