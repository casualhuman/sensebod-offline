/*
 * Choose a picture (ADM-M-Picture on a phone, ADM-Picture with the card
 * preview on a laptop): suggestions for this lesson, the gallery by group,
 * or the facilitator's own photo (which needs a description).
 */
import { useEffect, useState } from 'react';
import { adminApi, type AdminLesson, type GalleryPicture, type PictureGroup } from '@shared/api';
import { Button, EmptyState, ErrorState, Illustration, LESSON_TYPES, LoadingState } from '@shared/components';
import { IconCamera, IconInfoMark, IconPlus, IconStar, IconTick, IconVideoFile } from '@shared/icons';
import { navigate, useLocation, useParams } from '@shared/router';
import { adminPaths } from '../adminPaths';
import { FilePicker, InputField, LessonPreview, PageHead } from '../components';
import { AdminFrame } from '../frame/AdminFrame';
import { classifyFileName } from '../lib/files';
import { useAction, useIsLaptop } from '../lib/hooks';
import { useAdminApi } from '../session';
import './place.css';

const GROUPS: { value: PictureGroup | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'child-protection', label: 'Child protection' },
  { value: 'agriculture', label: 'Agriculture' },
  { value: 'climate', label: 'Climate' },
  { value: 'school', label: 'School' },
  { value: 'people-places', label: 'People and places' },
  { value: 'own', label: 'Your own' },
];
const PAGE_SIZE = 12;
const ALT_MAX = 200;

function PictureOption({ picture, name, chosen, onChoose }: { picture: GalleryPicture; name: string; chosen: boolean; onChoose: (picture: GalleryPicture) => void }) {
  return (
    <label className={chosen ? 'adm-pic adm-pic--chosen' : 'adm-pic'}>
      <input type="radio" name={name} checked={chosen} onChange={() => onChoose(picture)} />
      <span className="adm-pic__img">
        <Illustration src={picture.url} alt="" />
      </span>
      <span className="adm-pic__alt">{picture.alt || 'Picture without a description'}</span>
      {chosen ? (
        <span className="adm-pic__chosen" aria-hidden="true">
          <IconTick size={20} />
          Chosen
        </span>
      ) : null}
    </label>
  );
}

function PictureForm({ lesson, backTo }: { lesson: AdminLesson; backTo: string }) {
  const laptop = useIsLaptop();
  const [chosen, setChosen] = useState<GalleryPicture | null>(lesson.pictureId && lesson.picture ? { id: lesson.pictureId, group: 'own', url: lesson.picture.url, alt: lesson.picture.alt } : null);
  const [group, setGroup] = useState<PictureGroup | 'all'>('all');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<GalleryPicture[]>([]);
  const [search, setSearch] = useState('');
  const [own, setOwn] = useState<{ file: File; alt: string; error: string | null } | null>(null);
  const [ownProblem, setOwnProblem] = useState<string | null>(null);

  const suggested = useAdminApi((signal) => adminApi.getPictures({ suggestForLessonId: lesson.id, pageSize: 1 }, { signal }), [lesson.id]);
  const gallery = useAdminApi((signal) => adminApi.getPictures({ group: group === 'all' ? undefined : group, page, pageSize: PAGE_SIZE }, { signal }), [group, page]);

  // Pages add up under "Show more"; a new group starts the list again. The answer is copied, never changed in place.
  const answer = gallery.data;
  useEffect(() => {
    if (!answer) return;
    setItems((current) => (answer.page === 1 ? answer.items.slice() : current.concat(answer.items.filter((picture) => !current.some((other) => other.id === picture.id)))));
  }, [answer]);

  const use = useAction(async () => {
    await adminApi.updateLesson(lesson.id, { pictureId: chosen ? chosen.id : null });
    navigate(backTo);
  });
  const addOwn = useAction(async () => {
    if (!own) return;
    const picture = await adminApi.uploadPicture(own.file, own.alt.trim()).promise;
    setItems((current) => [picture].concat(current));
    setChosen(picture);
    setOwn(null);
  });

  const ownChosen = (files: File[]) => {
    const file = files[0];
    if (!file) return;
    if (classifyFileName(file.name).kind !== 'photo' || file.size === 0) {
      setOwnProblem('Choose a photo (JPG or PNG).');
      return;
    }
    setOwnProblem(null);
    setOwn({ file, alt: '', error: null });
  };

  const words = search.trim().toLowerCase();
  const shown = words ? items.filter((picture) => picture.alt.toLowerCase().indexOf(words) !== -1) : items;
  const total = answer ? answer.total : 0;
  const hasMore = items.length < total;
  const suggestions = suggested.data ? suggested.data.suggested : [];
  const groupLabel = GROUPS.find((entry) => entry.value === group)?.label ?? '';

  const body = (
    <div className="adm-stack--lg">
      {suggestions.length > 0 ? (
        <section className="adm-stack" aria-labelledby="adm-sg-h">
          <h2 id="adm-sg-h" className="adm-h2 adm-row">
            <IconStar size={26} />
            <span>Suggested for this lesson</span>
          </h2>
          <p className="adm-small">Matched to the title{lesson.placementLabel ? ` and to ${lesson.placementLabel.split(' → ')[0]}` : ''}.</p>
          <ul className="adm-gallery">
            {suggestions.map((picture) => (
              <li key={picture.id}>
                <PictureOption picture={picture} name="adm-pic-sg" chosen={chosen?.id === picture.id} onChoose={setChosen} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="adm-stack" aria-labelledby="adm-all-h">
        <h2 id="adm-all-h" className="adm-h2">
          All pictures
        </h2>
        <p className="adm-small">Choose a group to see its pictures.</p>
        <div className="adm-groupbar" role="group" aria-label="Picture groups">
          {GROUPS.map((entry) => (
            <button
              key={entry.value}
              type="button"
              aria-pressed={group === entry.value}
              onClick={() => {
                if (group === entry.value) return;
                setGroup(entry.value);
                setPage(1);
                setItems([]);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>
        {laptop ? <InputField label="Search pictures" type="search" placeholder="e.g. farm, school, flood" hint="Searches the pictures shown below. Use Show more to search further." value={search} maxLength={60} onChange={(event) => setSearch(event.target.value)} /> : null}
        {gallery.error && items.length === 0 ? (
          <ErrorState title="The pictures did not load" error={gallery.error} onRetry={gallery.reload} />
        ) : gallery.loading && items.length === 0 ? (
          <LoadingState label="Loading pictures…" />
        ) : items.length === 0 ? (
          <EmptyState title="No pictures in this group yet">Choose another group, or use your own photo below.</EmptyState>
        ) : (
          <>
            <p className="adm-small" role="status">
              {groupLabel} · showing {shown.length} of {total}
            </p>
            {shown.length === 0 ? <EmptyState title="No picture matches those words">Try another word, or tap Show more.</EmptyState> : null}
            <ul className="adm-gallery">
              {shown.map((picture) => (
                <li key={picture.id}>
                  <PictureOption picture={picture} name="adm-pic" chosen={chosen?.id === picture.id} onChoose={setChosen} />
                </li>
              ))}
            </ul>
            {gallery.error ? <ErrorState title="More pictures did not load" error={gallery.error} onRetry={gallery.reload} /> : null}
            {hasMore && !gallery.error ? (
              <Button variant="secondary" size="sm" fullWidth working={gallery.loading} workingLabel="Loading more…" icon={<IconPlus size={24} />} onClick={() => setPage((current) => current + 1)}>
                Show more pictures
              </Button>
            ) : null}
          </>
        )}
      </section>

      <section className="adm-stack" aria-labelledby="adm-own-h">
        <h2 id="adm-own-h" className="adm-h2">
          Or use your own
        </h2>
        {own ? (
          <div className="adm-card adm-stack">
            <InputField
              label="What does the photo show?"
              hint={`For people who cannot see it. ${own.file.name}`}
              value={own.alt}
              maxLength={ALT_MAX}
              error={own.error ?? addOwn.error}
              onChange={(event) => setOwn({ ...own, alt: event.target.value, error: null })}
            />
            <div className="adm-cluster">
              <Button
                size="sm"
                working={addOwn.working}
                workingLabel="Adding your photo…"
                onClick={() => {
                  if (!own.alt.trim()) setOwn({ ...own, error: 'Describe the photo first.' });
                  else void addOwn.run();
                }}
              >
                Add to the gallery
              </Button>
              <button type="button" className="adm-mini-btn" onClick={() => setOwn(null)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <FilePicker accept="image/*" capture={laptop ? undefined : 'environment'} onFiles={ownChosen} className="adm-card adm-card--tappable adm-row">
              <span className="adm-disc" aria-hidden="true">
                <IconCamera size={26} />
              </span>
              <span className="adm-row__grow">
                <span className="adm-card__title">{laptop ? 'Upload your own' : 'Take your own photo'}</span>
                <span className="adm-small">It will be added to this gallery for next time.</span>
              </span>
            </FilePicker>
            {laptop ? null : (
              <FilePicker accept="image/*" onFiles={ownChosen} className="adm-mini-btn">
                <IconPlus size={22} />
                Choose a photo from your phone
              </FilePicker>
            )}
            {ownProblem ? (
              <p className="adm-inline-error" role="alert">
                {ownProblem}
              </p>
            ) : null}
          </>
        )}
        <div className="adm-card adm-card--dashed adm-row" aria-disabled="true">
          <span className="adm-disc adm-disc--muted" aria-hidden="true">
            <IconVideoFile size={26} />
          </span>
          <span className="adm-row__grow">
            <span className="adm-card__title">Use a frame from the video</span>
            <span className="adm-small">Not available yet on this bag.</span>
          </span>
        </div>
      </section>
    </div>
  );

  const useButton = (
    <>
      <p className="adm-actionbar__note">{chosen ? `Chosen: ${chosen.alt || 'a picture'}` : 'No picture chosen'}</p>
      <Button fullWidth working={use.working} workingLabel="Saving the picture…" icon={<IconTick size={26} />} onClick={() => void use.run()}>
        {chosen ? 'Use this picture' : 'Use no picture'}
      </Button>
      {use.error ? (
        <p className="adm-inline-error" role="alert">
          {use.error}
        </p>
      ) : null}
    </>
  );

  return (
    <AdminFrame title="Choose a picture" nav={lesson.placement ? 'library' : 'add'} wide={laptop} back={{ to: backTo }} action={laptop ? undefined : useButton}>
      <PageHead eyebrow="Lesson picture" title="Choose a picture" />
      <div className="adm-card adm-row">
        <span className="adm-disc" aria-hidden="true">
          <IconInfoMark size={26} />
        </span>
        <p className="adm-row__grow">
          <span className="adm-small">Picture for</span>
          <span className="adm-card__title">{lesson.title}</span>
          <span className="adm-small">
            {LESSON_TYPES[lesson.type].label}
            {lesson.placementLabel ? ` · ${lesson.placementLabel}` : ''}
          </span>
        </p>
      </div>
      <p className="adm-small">Learners see this picture on the lesson card. Tap a picture to choose it.</p>
      {laptop ? (
        <div className="adm-split">
          {body}
          <aside className="adm-split__aside adm-card adm-stack" aria-labelledby="adm-pv-h">
            <h2 id="adm-pv-h" className="adm-h2">
              Chosen picture
            </h2>
            <p className="adm-small">How learners will see it</p>
            <LessonPreview lesson={{ ...lesson, picture: chosen ? { url: chosen.url, alt: chosen.alt } : null }} />
            {useButton}
          </aside>
        </div>
      ) : (
        body
      )}
    </AdminFrame>
  );
}

export default function Picture() {
  const { lessonId } = useParams<'lessonId'>();
  const from = new URLSearchParams(useLocation().search).get('from');
  const backTo = from === 'check' ? adminPaths.check(lessonId) : adminPaths.place(lessonId);
  const lesson = useAdminApi((signal) => adminApi.getAdminLesson(lessonId, { signal }), [lessonId]);
  const data = lesson.data && lesson.data.id === lessonId ? lesson.data : null;
  if (!data) {
    return (
      <AdminFrame title="Choose a picture" nav="add" back={{ to: backTo }}>
        {lesson.error ? <ErrorState title="This lesson did not open" error={lesson.error} onRetry={lesson.reload} /> : <LoadingState label="Opening the lesson…" />}
      </AdminFrame>
    );
  }
  return <PictureForm key={data.id} lesson={data} backTo={backTo} />;
}
